import { z } from "zod";
import type { Store, Row } from "./db";
import { assert, requireRow, id, now, audit } from "./common";
import { createNode, activateWorkflow } from "./project-service";
import { createSection } from "./section-service";
import {
  createAgent,
  createSession,
  sessionInProject,
} from "./collaboration-service";
import { configLayers } from "./agent-config-layers";
import { sourceReferenceSchema, validateSourceReference } from "./story-range";

export function sessionProfile(s: Store, p: string, sessionId: string) {
  const session = sessionInProject(s, p, sessionId);
  assert(session.status === "open", "会话已关闭");
  const agent = requireRow(
    s.one("SELECT * FROM agents WHERE id=?", String(session.agent_id)),
    "AI",
  );
  return {
    session,
    agent,
    profile: configLayers(s, String(agent.id), Number(agent.config_version))
      ?.system.id,
  };
}
export function coordinatorSession(s: Store, p: string, sessionId: string) {
  const actor = sessionProfile(s, p, sessionId);
  assert(actor.session.node_type === "coordinator", "此操作由总控协调确认");
  return actor;
}
export function preparationSetup(s: Store, p: string) {
  return requireRow(
    s.one("SELECT * FROM preparation_setups WHERE project_id=?", p),
    "前期协作",
  );
}
/** Register only the requested specialty. Membership and execution are separate. */
export function startPreparation(
  s: Store,
  p: string,
  input: unknown,
): Row & { execution: "not_configured" } {
  const d = z
    .object({
      coordinatorSessionId: z.uuid(),
      profile: z
        .enum(["source-analysis", "screenwriting"])
        .default("source-analysis"),
    })
    .strict()
    .parse(input);
  const coordinator = coordinatorSession(s, p, d.coordinatorSessionId);
  return s.transaction(() => {
    const existing = s.one(
      "SELECT * FROM preparation_setups WHERE project_id=?",
      p,
    );
    if (existing) {
      assert(
        existing.coordinator_node_id === coordinator.session.node_id,
        "已在另一总控流程中建立前期协作",
      );
    }
    assert(
      s.one("SELECT id FROM story_sources WHERE project_id=?", p),
      "请先保存故事原文",
    );
    const workflowId = String(
      requireRow(
        s.one(
          "SELECT workflow_id FROM nodes WHERE id=?",
          String(coordinator.session.node_id),
        ),
      ).workflow_id,
    );
    const section =
      s.one(
        "SELECT g.* FROM workflow_sections g WHERE g.workflow_id=? AND g.phase='preparation' ORDER BY g.position LIMIT 1",
        workflowId,
      ) ??
      createSection(s, p, {
        workflowId,
        name: "改编准备",
        phase: "preparation",
      });
    const make = (
      profile: string,
      name: string,
      objective: string,
      dependencies: string[],
    ) => {
      const node = createNode(s, p, {
        workflowId,
        sectionId: section.id,
        name,
        objective,
        dependencies,
      })!;
      s.run(
        "INSERT INTO node_ai_profiles VALUES(?,?)",
        String(node.id),
        profile,
      );
      const agent = createAgent(s, p, {
        nodeId: node.id,
        name: `${name} AI`,
        purpose: objective,
        instructions: `## 身份\n你负责${name}。\n## 目标\n${objective}\n## 协作\n按系统规则与总控及相关子 AI 讨论，按需读取已存资料并保存成果。`,
      });
      s.run(
        "INSERT INTO ai_relations VALUES(?,?)",
        String(agent.id),
        String(coordinator.agent.id),
      );
      createSession(s, p, { agentId: agent.id, title: `${name}讨论` });
      return node;
    };
    if (!existing)
      s.run(
        "INSERT INTO preparation_setups VALUES(?,?,?,NULL,NULL)",
        p,
        workflowId,
        String(coordinator.session.node_id),
      );
    const column =
      d.profile === "source-analysis" ? "analysis_node_id" : "writing_node_id";
    let nodeId = existing?.[column];
    if (!nodeId) {
      const node =
        d.profile === "source-analysis"
          ? make(
              d.profile,
              "原作初步分析",
              "按需了解故事基本信息，说明原文依据与已读范围。",
              [],
            )
          : make(
              d.profile,
              "改编框架与分集",
              "依据已确认需求提出改编框架，确认后直接建立剧集入口并归位原文。",
              existing?.analysis_node_id
                ? [String(existing.analysis_node_id)]
                : [],
            );
      nodeId = node.id;
      s.run(
        `UPDATE preparation_setups SET ${column}=? WHERE project_id=?`,
        String(nodeId),
        p,
      );
      audit(s, p, "preparation.specialist_registered", String(nodeId), {
        profile: d.profile,
      });
    }
    let ss = s.one(
      "SELECT ss.* FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN ai_relations r ON r.child_id=a.id WHERE a.node_id=? AND r.parent_id=? AND ss.status='open' ORDER BY ss.rowid DESC LIMIT 1",
      String(nodeId),
      String(coordinator.agent.id),
    );
    if (!ss) {
      const agent = requireRow(
        s.one(
          "SELECT a.id FROM agents a JOIN ai_relations r ON r.child_id=a.id WHERE a.node_id=? AND r.parent_id=? ORDER BY a.rowid LIMIT 1",
          String(nodeId),
          String(coordinator.agent.id),
        ),
        "专业 AI",
      );
      ss = createSession(s, p, {
        agentId: agent.id,
        title:
          d.profile === "source-analysis"
            ? "原作初步分析讨论"
            : "改编框架与分集讨论",
      });
    }
    return {
      ...preparationSetup(s, p),
      sessionId: ss.id,
      profile: d.profile,
      execution: "not_configured",
    };
  });
}
export const preparationContentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().min(1).max(10000),
    details: z.string().max(30000).default(""),
    unresolved: z.array(z.string().max(2000)).max(50).default([]),
    sources: z.array(sourceReferenceSchema).max(100).default([]),
    episodeCount: z.number().int().positive().optional(),
    minutesPerEpisode: z.number().positive().optional(),
    scope: z.string().max(5000).default(""),
    constraints: z.array(z.string().max(2000)).max(100).default([]),
  })
  .strict();
export function preparationRecord(
  s: Store,
  p: string,
  key: string,
): Row & { content: z.infer<typeof preparationContentSchema> } {
  const row = requireRow(
    s.one(
      "SELECT r.*,v.decision,v.reason FROM preparation_records r LEFT JOIN preparation_reviews v ON v.record_id=r.id WHERE r.project_id=? AND r.id=?",
      p,
      key,
    ),
    "前期成果",
  );
  return { ...row, content: JSON.parse(String(row.content_json)) };
}
export function listPreparationRecords(s: Store, p: string) {
  return s.all(
    "SELECT r.id,r.kind,r.revision,r.previous_id,r.basis_id,r.author_session_id,r.created_at,v.decision,json_extract(r.content_json,'$.title') AS title,json_extract(r.content_json,'$.summary') AS summary FROM preparation_records r LEFT JOIN preparation_reviews v ON v.record_id=r.id WHERE r.project_id=? ORDER BY r.created_at,r.id",
    p,
  );
}
export function confirmedRecord(
  s: Store,
  p: string,
  key: string,
  kind: string,
) {
  const record = preparationRecord(s, p, key);
  assert(
    record.kind === kind && record.decision === "confirmed",
    "需要对应类型的已确认成果",
  );
  assert(
    !s.one("SELECT id FROM preparation_records WHERE previous_id=?", key),
    "该成果已有后续修订，请先确认最新版本",
  );
  return record;
}
export function savePreparationRecord(s: Store, p: string, input: unknown) {
  const d = z
    .object({
      kind: z.enum(["overview", "requirements", "framework"]),
      authorSessionId: z.uuid(),
      basisId: z.uuid().optional(),
      previousId: z.uuid().optional(),
      content: preparationContentSchema,
    })
    .strict()
    .parse(input);
  const actor = sessionProfile(s, p, d.authorSessionId),
    setup = preparationSetup(s, p);
  assert(
    d.kind === "overview"
      ? actor.profile === "source-analysis"
      : d.kind === "requirements"
        ? actor.session.node_type === "coordinator"
        : actor.profile === "screenwriting",
    "成果应由对应职责的 AI 提交",
  );
  assert(
    [
      setup.coordinator_node_id,
      setup.analysis_node_id,
      setup.writing_node_id,
    ].includes(actor.session.node_id),
    "AI 不属于当前前期协作",
  );
  for (const source of d.content.sources) validateSourceReference(s, p, source);
  return s.transaction(() => {
    if (d.kind !== "overview") {
      assert(d.basisId, "请引用前一步已确认成果");
      confirmedRecord(
        s,
        p,
        d.basisId!,
        d.kind === "requirements" ? "overview" : "requirements",
      );
    }
    let revision = 1;
    if (d.previousId) {
      const old = preparationRecord(s, p, d.previousId);
      assert(old.kind === d.kind, "修订必须属于同类成果");
      assert(
        !s.one(
          "SELECT id FROM preparation_records WHERE previous_id=?",
          d.previousId,
        ),
        "已有后续修订，请刷新",
      );
      revision = Number(old.revision) + 1;
    } else
      assert(
        !s.one(
          "SELECT id FROM preparation_records WHERE project_id=? AND kind=?",
          p,
          d.kind,
        ),
        "已有该类成果，请明确修订来源",
      );
    const key = id();
    s.run(
      "INSERT INTO preparation_records VALUES(?,?,?,?,?,?,?,?,?)",
      key,
      p,
      d.kind,
      d.authorSessionId,
      d.basisId ?? null,
      JSON.stringify(d.content),
      d.previousId ?? null,
      revision,
      now(),
    );
    audit(s, p, "preparation.result_saved", key, { kind: d.kind, revision });
    return preparationRecord(s, p, key);
  });
}
export function reviewPreparation(
  s: Store,
  p: string,
  key: string,
  input: unknown,
) {
  const d = z
    .object({
      coordinatorSessionId: z.uuid(),
      decision: z.enum(["confirmed", "changes_requested"]),
      userMessageId: z.uuid().optional(),
      reason: z.string().min(1).max(5000),
    })
    .strict()
    .parse(input);
  const actor = coordinatorSession(s, p, d.coordinatorSessionId),
    record = preparationRecord(s, p, key),
    setup = preparationSetup(s, p);
  assert(
    actor.session.node_id === setup.coordinator_node_id,
    "请由本流程总控确认",
  );
  return s.transaction(() => {
    const prior = s.one(
      "SELECT * FROM preparation_reviews WHERE record_id=?",
      key,
    );
    if (prior) {
      assert(
        prior.decision === d.decision &&
          prior.reason === d.reason &&
          prior.user_message_id === (d.userMessageId ?? null),
        "已有审核结果，请以新修订继续讨论",
      );
      return preparationRecord(s, p, key);
    }
    if (d.decision === "confirmed" && record.kind !== "overview") {
      assert(d.userMessageId, "确认需求或改编框架需引用用户确认消息");
      assert(
        s.one(
          "SELECT m.id FROM messages m JOIN sessions ss ON ss.id=m.session_id WHERE m.id=? AND m.sender_type='human' AND ss.agent_id=?",
          d.userMessageId!,
          String(actor.agent.id),
        ),
        "用户确认消息必须属于当前总控",
      );
      confirmedRecord(
        s,
        p,
        String(record.basis_id),
        record.kind === "requirements" ? "overview" : "requirements",
      );
    }
    assert(
      !s.one("SELECT id FROM preparation_records WHERE previous_id=?", key),
      "不能审核已被修订的成果",
    );
    s.run(
      "INSERT INTO preparation_reviews VALUES(?,?,?,?,?,?)",
      key,
      d.coordinatorSessionId,
      d.userMessageId ?? null,
      d.decision,
      d.reason,
      now(),
    );
    if (d.decision === "confirmed" && record.kind === "framework")
      activateWorkflow(s, p, String(setup.workflow_id));
    audit(s, p, "preparation.reviewed", key, { decision: d.decision });
    return preparationRecord(s, p, key);
  });
}
