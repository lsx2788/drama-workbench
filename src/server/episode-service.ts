import { z } from "zod";
import { createHash } from "node:crypto";
import type { Store, Row } from "./db";
import { assert, requireRow, id, audit } from "./common";
import { appendUnit } from "./section-service";
import { sourceReferenceSchema, validateSourceReference } from "./story-range";
import {
  sessionProfile,
  preparationSetup,
  confirmedRecord,
} from "./preparation-service";
import { versionInProject } from "./asset-service";

export function episodeDetail(
  s: Store,
  p: string,
  key: string,
): Row & { code: string; number: number; sources: Row[]; assets: Row[] } {
  const row = requireRow(
    s.one(
      "SELECT e.*,g.name,g.kind,g.position,g.workflow_id FROM episode_entries e JOIN workflow_sections g ON g.id=e.section_id WHERE e.project_id=? AND (e.section_id=? OR printf('E%04d',e.serial)=?)",
      p,
      key,
      key,
    ),
    "剧集",
  );
  const sources = s.all(
    "SELECT r.*,st.original_name,st.sha256 FROM episode_sources r JOIN story_sources st ON st.id=r.story_id WHERE r.section_id=? ORDER BY r.position",
    String(row.section_id),
  );
  return {
    ...row,
    code: `E${String(row.serial).padStart(4, "0")}`,
    number: Number(row.position) + 1,
    sources,
    assets: s.all(
      "SELECT r.*,a.code,a.name,v.version,v.status FROM episode_asset_refs r JOIN asset_versions v ON v.id=r.version_id JOIN assets a ON a.id=v.asset_id WHERE r.section_id=?",
      String(row.section_id),
    ),
  };
}
export function listEpisodes(s: Store, p: string, input: unknown = {}) {
  const d = z
    .object({
      workflowId: z.uuid().optional(),
      around: z.string().optional(),
      before: z.coerce.number().int().min(0).max(100).default(0),
      after: z.coerce.number().int().min(0).max(100).default(0),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    })
    .strict()
    .parse(input);
  const rows = s.all(
    "SELECT e.section_id AS id,e.serial,printf('E%04d',e.serial) AS code,g.position+1 AS number,g.position,g.name,g.kind,e.summary,g.workflow_id,e.framework_id,(SELECT COUNT(*) FROM episode_sources r WHERE r.section_id=e.section_id) AS source_count FROM episode_entries e JOIN workflow_sections g ON g.id=e.section_id WHERE e.project_id=? AND (? IS NULL OR g.workflow_id=?) ORDER BY g.workflow_id,g.position,g.id",
    p,
    d.workflowId ?? null,
    d.workflowId ?? null,
  );
  if (d.around) {
    const center = episodeDetail(s, p, d.around);
    assert(
      !d.workflowId || center.workflow_id === d.workflowId,
      "剧集不属于指定流程",
    );
    const ordered = rows.filter(
        (row) => row.workflow_id === center.workflow_id,
      ),
      index = ordered.findIndex((row) => row.id === center.section_id);
    return ordered.slice(Math.max(0, index - d.before), index + d.after + 1);
  }
  assert(!d.before && !d.after, "相邻查询必须指定 around 编号");
  return rows.slice(d.offset, d.offset + d.limit);
}
export function createEpisodes(s: Store, p: string, input: unknown) {
  const d = z
    .object({
      writerSessionId: z.uuid(),
      frameworkId: z.uuid(),
      requestKey: z.uuid(),
      units: z
        .array(
          z
            .object({
              name: z.string().min(1).max(200),
              kind: z.enum(["episode", "chapter"]).default("episode"),
              summary: z.string().max(1000).default(""),
              sources: z.array(sourceReferenceSchema).min(1).max(100),
              assetVersionIds: z.array(z.uuid()).max(100).default([]),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  const writer = sessionProfile(s, p, d.writerSessionId),
    setup = preparationSetup(s, p);
  assert(
    writer.profile === "screenwriting" &&
      writer.session.node_id === setup.writing_node_id,
    "由当前编剧直接建立剧集入口",
  );
  const hash = createHash("sha256").update(JSON.stringify(d)).digest("hex");
  return s.transaction(() => {
    const old = s.one(
      "SELECT * FROM writer_batches WHERE project_id=? AND request_key=?",
      p,
      d.requestKey,
    );
    if (old) {
      assert(old.request_hash === hash, "分集请求已改变，请使用新请求编号");
      return JSON.parse(String(old.response_json));
    }
    const framework = confirmedRecord(s, p, d.frameworkId, "framework");
    confirmedRecord(s, p, String(framework.basis_id), "requirements");
    assert(
      s.one(
        "SELECT id FROM workflows WHERE id=? AND status='active'",
        String(setup.workflow_id),
      ),
      "改编框架确认并发布流程后才能建立剧集",
    );
    const created = [];
    for (const unit of d.units) {
      for (const source of unit.sources) validateSourceReference(s, p, source);
      for (const asset of unit.assetVersionIds)
        assert(
          versionInProject(s, p, asset).status === "approved",
          "章节引用需使用已定稿资产版本",
        );
      const result = appendUnit(s, p, {
        workflowId: setup.workflow_id,
        name: unit.name,
        kind: unit.kind,
        steps: [],
      });
      const serial = Number(
        s.one(
          "SELECT serial FROM episode_entries WHERE section_id=?",
          String(result.section.id),
        )?.serial,
      );
      s.run(
        "UPDATE episode_entries SET framework_id=?,summary=?,created_by=? WHERE section_id=?",
        d.frameworkId,
        unit.summary,
        String(writer.agent.id),
        String(result.section.id),
      );
      unit.sources.forEach((source, position) =>
        s.run(
          "INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?)",
          id(),
          String(result.section.id),
          position,
          source.storyId,
          source.startByte ?? null,
          source.endByte ?? null,
          source.encoding ?? null,
          source.locator,
        ),
      );
      for (const asset of new Set(unit.assetVersionIds))
        s.run(
          "INSERT INTO episode_asset_refs VALUES(?,?,?)",
          String(result.section.id),
          asset,
          "分集时引用的公共资产",
        );
      created.push({
        id: result.section.id,
        code: `E${String(serial).padStart(4, "0")}`,
        name: unit.name,
        summary: unit.summary,
        url: `/api/v1/projects/${p}/episodes/${result.section.id}`,
      });
    }
    const response = {
      episodes: created,
      workflowId: setup.workflow_id,
      stage: "source_assigned",
      message: "仅建立入口并保存原文引用，未改写原文或建立集内步骤",
    };
    s.run(
      "INSERT INTO writer_batches VALUES(?,?,?,?)",
      p,
      d.requestKey,
      hash,
      JSON.stringify(response),
    );
    audit(s, p, "episodes.source_assigned", String(setup.workflow_id), {
      ids: created.map((row) => row.id),
      writerId: writer.agent.id,
    });
    return response;
  });
}
export function reorderEpisodes(s: Store, p: string, input: unknown) {
  const d = z
    .object({
      writerSessionId: z.uuid(),
      episodeIds: z.array(z.uuid()).min(1).max(1000),
    })
    .strict()
    .parse(input);
  const writer = sessionProfile(s, p, d.writerSessionId),
    setup = preparationSetup(s, p);
  assert(
    writer.profile === "screenwriting" &&
      writer.session.node_id === setup.writing_node_id,
    "由当前编剧调整剧集顺序",
  );
  const existing = s.all(
    "SELECT g.id FROM workflow_sections g WHERE g.workflow_id=? AND g.phase='unit'",
    String(setup.workflow_id),
  );
  assert(
    new Set(d.episodeIds).size === d.episodeIds.length &&
      existing.length === d.episodeIds.length &&
      existing.every((row) => d.episodeIds.includes(String(row.id))),
    "请提交本流程所有剧集 ID，不重复、不遗漏",
  );
  return s.transaction(() => {
    d.episodeIds.forEach((key, index) =>
      s.run("UPDATE workflow_sections SET position=? WHERE id=?", index, key),
    );
    audit(s, p, "episodes.reordered", String(setup.workflow_id), {
      ids: d.episodeIds,
    });
    return listEpisodes(s, p, { workflowId: setup.workflow_id, limit: 200 });
  });
}
