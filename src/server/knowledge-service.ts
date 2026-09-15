import { z } from "zod";
import type { Store } from "./db";
import { assert, requireRow, id, now, audit } from "./common";
import { sessionProfile, coordinatorSession } from "./preparation-service";
import { sourceReferenceSchema, validateSourceReference } from "./story-range";
import { versionInProject } from "./asset-service";

const code = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const common = {
  code,
  expectedRevision: z.number().int().nonnegative().default(0),
  description: z.string().max(10000).default(""),
  sources: z.array(sourceReferenceSchema).max(50).default([]),
};
const payloadSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    entities: z
      .array(
        z
          .object({
            ...common,
            name: z.string().min(1).max(200),
            kind: z.enum(["person", "concept", "setting"]),
            role: z.string().max(500).default(""),
            assetVersionIds: z.array(z.uuid()).max(100).default([]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    relations: z
      .array(
        z
          .object({
            ...common,
            from: code,
            to: code,
            label: z.string().min(1).max(200),
            period: z.string().max(1000).default(""),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();
export function knowledge(s: Store, p: string) {
  return {
    entities: s
      .all(
        "SELECT * FROM knowledge_entities WHERE project_id=? ORDER BY code",
        p,
      )
      .map((row) => ({
        ...JSON.parse(String(row.data_json)),
        revision: row.revision,
        proposalId: row.proposal_id,
      })),
    relations: s
      .all(
        "SELECT * FROM knowledge_relations WHERE project_id=? ORDER BY code",
        p,
      )
      .map((row) => ({
        ...JSON.parse(String(row.data_json)),
        revision: row.revision,
        proposalId: row.proposal_id,
      })),
    proposals: s.all(
      "SELECT k.id,k.author_session_id,k.created_at,json_extract(k.payload_json,'$.summary') AS summary,r.decision,r.reason FROM knowledge_proposals k LEFT JOIN knowledge_reviews r ON r.proposal_id=k.id WHERE k.project_id=? ORDER BY k.created_at",
      p,
    ),
  };
}
export function proposeKnowledge(s: Store, p: string, input: unknown) {
  const d = z
    .object({ authorSessionId: z.uuid(), payload: payloadSchema })
    .strict()
    .parse(input);
  sessionProfile(s, p, d.authorSessionId);
  assert(
    d.payload.entities.length || d.payload.relations.length,
    "请提供具体增补",
  );
  for (const items of [d.payload.entities, d.payload.relations])
    assert(
      new Set(items.map((row) => row.code)).size === items.length,
      "同批次编号不能重复",
    );
  for (const entry of [...d.payload.entities, ...d.payload.relations])
    for (const source of entry.sources) validateSourceReference(s, p, source);
  for (const entity of d.payload.entities)
    for (const version of entity.assetVersionIds)
      versionInProject(s, p, version);
  for (const relation of d.payload.relations)
    for (const endpoint of [relation.from, relation.to])
      assert(
        d.payload.entities.some((row) => row.code === endpoint) ||
          s.one(
            "SELECT code FROM knowledge_entities WHERE project_id=? AND code=?",
            p,
            endpoint,
          ),
        "关系端点必须是本项目已登记或本次提议的对象",
      );
  const key = id();
  s.run(
    "INSERT INTO knowledge_proposals VALUES(?,?,?,?,?)",
    key,
    p,
    d.authorSessionId,
    JSON.stringify(d.payload),
    now(),
  );
  return { id: key, status: "proposed", summary: d.payload.summary };
}
export function knowledgeProposal(s: Store, p: string, key: string) {
  const row = requireRow(
    s.one(
      "SELECT k.*,r.decision,r.reason FROM knowledge_proposals k LEFT JOIN knowledge_reviews r ON r.proposal_id=k.id WHERE k.id=? AND k.project_id=?",
      key,
      p,
    ),
    "知识增补提议",
  );
  return { ...row, payload: JSON.parse(String(row.payload_json)) };
}
export function reviewKnowledge(
  s: Store,
  p: string,
  key: string,
  input: unknown,
) {
  const d = z
    .object({
      coordinatorSessionId: z.uuid(),
      decision: z.enum(["confirmed", "changes_requested"]),
      reason: z.string().min(1).max(5000),
    })
    .strict()
    .parse(input);
  coordinatorSession(s, p, d.coordinatorSessionId);
  const proposal = knowledgeProposal(s, p, key),
    payload = payloadSchema.parse(proposal.payload);
  const receipt = () => ({
    proposalId: key,
    decision: d.decision,
    entityCodes: payload.entities.map((entry) => entry.code),
    relationCodes: payload.relations.map((entry) => entry.code),
    url: `/api/v1/projects/${p}/knowledge/${key}`,
  });
  return s.transaction(() => {
    const prior = s.one(
      "SELECT * FROM knowledge_reviews WHERE proposal_id=?",
      key,
    );
    if (prior) {
      assert(
        prior.decision === d.decision && prior.reason === d.reason,
        "该提议已经审核，请提交新的增补",
      );
      return receipt();
    }
    if (d.decision === "confirmed") {
      for (const [table, items] of [
        ["knowledge_entities", payload.entities],
        ["knowledge_relations", payload.relations],
      ] as const)
        for (const entry of items) {
          const old = s.one(
            `SELECT revision FROM ${table} WHERE project_id=? AND code=?`,
            p,
            entry.code,
          );
          assert(
            Number(old?.revision ?? 0) === entry.expectedRevision,
            "共用资料已更新，请核对最新版本再提交",
          );
          s.run(
            `INSERT INTO ${table} VALUES(?,?,?,?,?) ON CONFLICT(project_id,code) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,proposal_id=excluded.proposal_id`,
            p,
            entry.code,
            JSON.stringify(entry),
            entry.expectedRevision + 1,
            key,
          );
        }
    }
    s.run(
      "INSERT INTO knowledge_reviews VALUES(?,?,?,?,?)",
      key,
      d.coordinatorSessionId,
      d.decision,
      d.reason,
      now(),
    );
    audit(s, p, "knowledge.reviewed", key, { decision: d.decision });
    return receipt();
  });
}
