import { z } from "zod";
import type { AgentKey, PromptLayers } from "../../domain/agent-config";
import {
  defaultSkillFields,
  type SkillEntry,
  type SkillDetail,
  type SkillFields,
  type SkillLoad,
} from "../../domain/skills";
import type { Database } from "../database";
import { ensure } from "../errors";
import type { SkillDocument } from "./skill-store";

export const skillIdSchema = z.string().regex(/^[a-z0-9-]{1,63}$/);
export const skillFieldsSchema = z
  .object({
    enabled: z.boolean(),
    instructions: z.string().max(8000),
    review: z.string().max(8000),
  })
  .strict();
export const readSkillSchema = z
  .object({
    id: skillIdSchema,
    reference: z.string().max(100).optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
type CustomRow = { revision: number; fields: string; created_at: string };
function applicable(doc: SkillDocument, key: AgentKey, kind?: string) {
  // Releases before .3 contain only image skills and no scope metadata.
  const scope = doc.scope ?? {
    production: ["assets", "frames", "board"],
    review: ["assets", "frames", "storyboard", "board"],
  };
  if (key === "coordinator") return true;
  if (key === "reviewer")
    return !kind || scope.review.some((value) => value === kind);
  return scope.production.some((value) => value === key);
}
export class SkillService {
  constructor(readonly db: Database) {}
  private check(projectId: string) {
    ensure(
      this.db.one("SELECT id FROM projects WHERE id=?", projectId),
      "找不到剧本",
      "NOT_FOUND",
      404,
    );
  }
  private release() {
    const row = this.db.one<{ version: string }>(
      "SELECT version FROM skill_selection WHERE id=1",
    );
    ensure(row, "尚未发布 Skill");
    return row.version;
  }
  private document(id: string, version = this.release()): SkillDocument {
    skillIdSchema.parse(id);
    const row = this.db.one<{ body: string }>(
      "SELECT body FROM skill_documents WHERE version=? AND skill_id=?",
      version,
      id,
    );
    ensure(row, "找不到此 Skill 版本", "NOT_FOUND", 404);
    return JSON.parse(row.body);
  }
  custom(
    projectId: string,
    id: string,
    revision?: number,
    systemVersion?: string,
  ) {
    this.check(projectId);
    this.document(id, systemVersion);
    const row =
      revision === 0
        ? undefined
        : revision === undefined
          ? this.db.one<CustomRow>(
              "SELECT * FROM project_skill_versions WHERE project_id=? AND skill_id=? ORDER BY revision DESC LIMIT 1",
              projectId,
              id,
            )
          : this.db.one<CustomRow>(
              "SELECT * FROM project_skill_versions WHERE project_id=? AND skill_id=? AND revision=?",
              projectId,
              id,
              revision,
            );
    if (revision !== undefined && revision > 0)
      ensure(row, "找不到 Skill 自定义版本", "NOT_FOUND", 404);
    return {
      revision: row?.revision ?? 0,
      fields: row
        ? skillFieldsSchema.parse(JSON.parse(row.fields))
        : defaultSkillFields(),
    };
  }
  catalog(projectId: string, key: AgentKey, kind?: string): SkillEntry[] {
    this.check(projectId);
    const version = this.release();
    return this.db
      .all<{ body: string }>(
        "SELECT body FROM skill_documents WHERE version=? ORDER BY skill_id",
        version,
      )
      .map((row) => JSON.parse(row.body) as SkillDocument)
      .filter((doc) => applicable(doc, key, kind))
      .map((doc) => {
        const custom = this.custom(projectId, doc.id);
        return {
          id: doc.id,
          title: doc.title,
          description: doc.description,
          version,
          customRevision: custom.revision,
          enabled: custom.fields.enabled,
          references: Object.keys(doc.resources).filter((name) =>
            name.startsWith("references/"),
          ),
        };
      });
  }
  detail(projectId: string, id: string): SkillDetail {
    this.check(projectId);
    const entry = this.catalog(projectId, "coordinator").find(
      (item) => item.id === id,
    );
    ensure(entry, "找不到此 Skill", "NOT_FOUND", 404);
    return {
      ...entry,
      resources: this.document(id, entry.version).resources,
      fields: this.custom(projectId, id).fields,
      versions: this.db
        .all<CustomRow>(
          "SELECT revision,created_at FROM project_skill_versions WHERE project_id=? AND skill_id=? ORDER BY revision DESC LIMIT 50",
          projectId,
          id,
        )
        .map((row) => ({ revision: row.revision, createdAt: row.created_at })),
    };
  }
  save(
    projectId: string,
    id: string,
    expectedRevision: number,
    fields: SkillFields,
  ) {
    const parsed = skillFieldsSchema.parse(fields);
    return this.db.transaction(() => {
      const current = this.custom(projectId, id);
      if (JSON.stringify(parsed) === JSON.stringify(current.fields))
        return current.revision;
      ensure(
        current.revision === expectedRevision,
        "Skill 已在别处更新，请重新读取后再保存",
        "CONFLICT",
        409,
      );
      this.db.run(
        "INSERT INTO project_skill_versions VALUES(?,?,?,?,?)",
        projectId,
        id,
        current.revision + 1,
        JSON.stringify(parsed),
        new Date().toISOString(),
      );
      return current.revision + 1;
    });
  }
  load(projectId: string, runId: string, raw: unknown): SkillLoad {
    const args = readSkillSchema.parse(raw);
    return this.db.transaction(() => {
      const run = this.db.one<{
        layers: string;
        agent_key: AgentKey;
        status: string;
      }>(
        "SELECT p.layers,p.agent_key,r.status FROM runs r JOIN run_prompt_snapshots p ON p.run_id=r.id WHERE r.id=? AND r.project_id=?",
        runId,
        projectId,
      );
      ensure(
        run && run.status === "running",
        "Skill 只能由当前执行读取",
        "FORBIDDEN",
        403,
      );
      const layers: PromptLayers = JSON.parse(run.layers);
      const entry = layers.skills?.find(
        (item) => item.id === args.id && item.enabled,
      );
      ensure(
        entry,
        "本轮未提供此 Skill，不能跨身份或绕过禁用读取",
        "FORBIDDEN",
        403,
      );
      const mode =
        run.agent_key === "reviewer" || run.agent_key === "coordinator"
          ? "review"
          : "production";
      const section =
        args.reference ?? (mode === "review" ? "review.md" : "SKILL.md");
      if (args.reference)
        ensure(
          entry.references.includes(args.reference),
          "参考章节不在本轮 Skill 目录中",
        );
      const prior = this.db.one<{ body: string }>(
        "SELECT body FROM run_skill_loads WHERE run_id=? AND skill_id=? AND section=?",
        runId,
        args.id,
        section,
      );
      if (prior) return JSON.parse(prior.body);
      if (args.reference)
        ensure(
          this.db.one(
            "SELECT run_id FROM run_skill_loads WHERE run_id=? AND skill_id=? AND section=?",
            runId,
            args.id,
            mode === "review" ? "review.md" : "SKILL.md",
          ),
          "先读取此 Skill 主体，再按需读取参考章节",
        );
      const doc = this.document(args.id, entry.version);
      const custom = this.custom(
        projectId,
        args.id,
        entry.customRevision,
        entry.version,
      ).fields;
      const addition = mode === "review" ? custom.review : custom.instructions;
      const body = doc.resources[section];
      ensure(body, "Skill 章节内容缺失");
      const loaded: SkillLoad = {
        id: entry.id,
        title: entry.title,
        version: entry.version,
        customRevision: entry.customRevision,
        section,
        mode,
        reason: args.reason,
        body: `${body}\n\n${args.reference || !addition.trim() ? "" : `## 用户自定义补充\n${addition.trim()}\n\n`}Skill 仅提供方法，不改变本轮角色权限、已确认需求和工具限制；示例是可选写法，不是新增验收门槛。`,
        loadedAt: new Date().toISOString(),
      };
      this.db.run(
        "INSERT INTO run_skill_loads VALUES(?,?,?,?,?)",
        runId,
        args.id,
        section,
        JSON.stringify(loaded),
        loaded.loadedAt,
      );
      return loaded;
    });
  }
  loads(projectId: string, runId: string): SkillLoad[] {
    this.check(projectId);
    ensure(
      this.db.one(
        "SELECT id FROM runs WHERE id=? AND project_id=?",
        runId,
        projectId,
      ),
      "找不到此执行记录",
      "NOT_FOUND",
      404,
    );
    return this.db
      .all<{ body: string }>(
        "SELECT body FROM run_skill_loads WHERE run_id=? ORDER BY loaded_at,skill_id,section",
        runId,
      )
      .map((row) => JSON.parse(row.body));
  }
}

export function skillCatalogInstructions(entries?: SkillEntry[]) {
  if (!entries?.length) return "";
  return `\n\n## 本轮可按需读取的 Skill\n目录仅含摘要，不代表已加载。按当前职责和交付选择相关条目并调用 read_skill，填写用途理由；无需逐项全读。先读主体，再按具体问题读取返回目录里的相关 reference。审核与总控由系统返回审核版。Skill 不增加工具权限：原作分析不编剧，整体编剧负责改编和分集，单集编剧维护场景与对白，分镜负责镜头表达，图片仍由对应制作 AI 生成。每轮以本轮目录和读取结果为准，不把旧会话中的 Skill 版本当本轮规则。\n${entries.map((item) => `- ${item.id}：${item.title} — ${item.description}（系统 ${item.version}；自定义 v${item.customRevision}）`).join("\n")}`;
}
