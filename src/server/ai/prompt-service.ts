import { z } from "zod";
import {
  agentKeys,
  agentNames,
  emptyCustomInstructions,
  type AgentKey,
  type CustomInstructions,
  type PromptLayers,
  type PromptSettings,
  type PromptExecution,
} from "../../domain/agent-config";
import type { TaskKind } from "../../domain/types";
import type { Actor } from "../contracts";
import { Database } from "../database";
import { ensure } from "../errors";
import { customRules, keyForActor, toolsForRole, toolLabels } from "./prompts";
import { readPromptRules } from "./prompt-rule-store";
import { SkillService } from "./skill-service";

export const agentKeySchema = z.enum(agentKeys);
export const customInstructionsSchema = z
  .object({
    identity: z.string().max(4000),
    goals: z.string().max(4000),
    requirements: z.string().max(12000),
    output: z.string().max(6000),
    examples: z.string().max(8000),
    counterexamples: z.string().max(8000),
  })
  .strict();
type Row = Record<string, any>;
export class PromptService {
  constructor(readonly db: Database) {}
  private check(projectId: string) {
    ensure(
      this.db.one("SELECT id FROM projects WHERE id=?", projectId),
      "找不到剧本",
      "NOT_FOUND",
      404,
    );
  }
  private current(projectId: string, key: AgentKey) {
    const row = this.db.one<Row>(
      "SELECT * FROM agent_prompt_versions WHERE project_id=? AND agent_key=? ORDER BY revision DESC LIMIT 1",
      projectId,
      key,
    );
    return {
      revision: row?.revision ?? 0,
      fields: row
        ? customInstructionsSchema.parse(JSON.parse(row.fields))
        : emptyCustomInstructions(),
    };
  }
  private layers(key: AgentKey, fields: CustomInstructions): PromptLayers {
    const rules = readPromptRules(this.db, key);
    return {
      rulesVersion: rules.version,
      system: rules.system,
      role: rules.role,
      developer: rules.developer,
      custom: customRules(fields, rules.customIntro, rules.customEmpty),
      tools: toolsForRole(
        key === "coordinator"
          ? "coordinator"
          : key === "reviewer"
            ? "reviewer"
            : "executor",
        key,
      ).map((id) => ({ id, name: toolLabels[id as keyof typeof toolLabels] })),
    };
  }
  settings(projectId: string, key: AgentKey): PromptSettings {
    this.check(projectId);
    agentKeySchema.parse(key);
    const current = this.current(projectId, key);
    const rows = this.db.all<Row>(
      `SELECT r.id,r.started_at,r.status,s.scope,s.role,t.kind,p.agent_key,p.config_revision
      FROM runs r JOIN sessions s ON r.session_id=s.id
      LEFT JOIN tasks t ON t.project_id=r.project_id AND t.id=s.scope
      LEFT JOIN run_prompt_snapshots p ON p.run_id=r.id
      WHERE r.project_id=? AND (p.agent_key=? OR (p.run_id IS NULL AND
        ((?='coordinator' AND s.role='coordinator') OR (?='reviewer' AND s.role='reviewer') OR (s.role='executor' AND t.kind=?))))
      ORDER BY r.started_at DESC LIMIT 20`,
      projectId,
      key,
      key,
      key,
      key,
    );
    return {
      key,
      name: agentNames[key],
      ...current,
      layers: {
        ...this.layers(key, current.fields),
        skills: new SkillService(this.db)
          .catalog(projectId, key)
          .filter((skill) => skill.enabled),
      },
      versions: this.db
        .all<Row>(
          "SELECT revision,created_at FROM agent_prompt_versions WHERE project_id=? AND agent_key=? ORDER BY revision DESC LIMIT 50",
          projectId,
          key,
        )
        .map((r) => ({ revision: r.revision, createdAt: r.created_at })),
      runs: rows.map((r) => ({
        id: r.id,
        time: r.started_at,
        status: r.status,
        scope: r.scope,
        revision: r.config_revision ?? null,
      })),
    };
  }
  save(
    projectId: string,
    key: AgentKey,
    fields: CustomInstructions,
    expectedRevision: number,
  ) {
    this.check(projectId);
    agentKeySchema.parse(key);
    const parsed = customInstructionsSchema.parse(fields);
    return this.db.transaction(() => {
      const current = this.current(projectId, key);
      // A repeated save after a lost response is harmless, but stale edits must not overwrite newer work.
      if (JSON.stringify(parsed) === JSON.stringify(current.fields))
        return current.revision;
      ensure(
        current.revision === expectedRevision,
        "配置已在别处更新，请重新打开后再修改",
        "CONFLICT",
        409,
      );
      const revision = current.revision + 1;
      this.db.run(
        "INSERT INTO agent_prompt_versions VALUES(?,?,?,?,?)",
        projectId,
        key,
        revision,
        JSON.stringify(parsed),
        new Date().toISOString(),
      );
      return revision;
    });
  }
  version(projectId: string, key: AgentKey, revision: number) {
    this.check(projectId);
    agentKeySchema.parse(key);
    if (revision === 0)
      return { revision: 0, fields: emptyCustomInstructions() };
    const row = this.db.one<Row>(
      "SELECT * FROM agent_prompt_versions WHERE project_id=? AND agent_key=? AND revision=?",
      projectId,
      key,
      revision,
    );
    ensure(row, "找不到此配置版本", "NOT_FOUND", 404);
    return {
      revision: row.revision,
      fields: customInstructionsSchema.parse(JSON.parse(row.fields)),
    };
  }
  /** Freeze only what this run will actually receive; never reconstruct history from current templates. */
  capture(projectId: string, runId: string, actor: Actor, kind?: TaskKind) {
    this.check(projectId);
    ensure(
      this.db.one(
        "SELECT id FROM runs WHERE id=? AND project_id=?",
        runId,
        projectId,
      ),
      "执行不属于此剧本",
    );
    const key = keyForActor(actor, kind);
    const prior = this.db.one<Row>(
      "SELECT * FROM run_prompt_snapshots WHERE run_id=?",
      runId,
    );
    if (prior) {
      ensure(prior.agent_key === key, "执行身份不匹配");
      return JSON.parse(prior.layers) as PromptLayers;
    }
    const current = this.current(projectId, key),
      layers = this.layers(key, current.fields);
    layers.skills = new SkillService(this.db)
      .catalog(projectId, key, kind)
      .filter((skill) => skill.enabled);
    if (actor.role === "reviewer")
      layers.role += `\n\n## 当前独立审核节点\n\n任务：${actor.taskId}；类型：${kind}。只审核此节点，通过 project 查询当前版本与目标；不得审核其他节点。`;
    this.db.run(
      "INSERT INTO run_prompt_snapshots VALUES(?,?,?,?)",
      runId,
      key,
      current.revision,
      JSON.stringify(layers),
    );
    return layers;
  }
  execution(projectId: string, runId: string): PromptExecution {
    this.check(projectId);
    const row = this.db.one<Row>(
      `SELECT r.*,s.scope,p.config_revision,p.layers FROM runs r
      LEFT JOIN sessions s ON s.id=r.session_id LEFT JOIN run_prompt_snapshots p ON p.run_id=r.id
      WHERE r.id=? AND r.project_id=?`,
      runId,
      projectId,
    );
    ensure(row, "找不到此执行记录", "NOT_FOUND", 404);
    return {
      id: row.id,
      skillLoads: new SkillService(this.db).loads(projectId, runId),
      time: row.started_at,
      status: row.status,
      scope: row.scope ?? "main",
      revision: row.config_revision ?? null,
      layers: row.layers ? JSON.parse(row.layers) : null,
      instructions: row.instructions ?? "尚未发送提示词",
      threadId: row.thread_id ?? undefined,
      turnId: row.turn_id ?? undefined,
    };
  }
}
