import { z } from "zod";
import type { Store, Row } from "./db";
import type { WorkflowOutline } from "../shared/workflow-outline";
import {
  FIXED_OUTLINE_KEYS,
  FIXED_OUTLINE_STEPS,
  OUTLINE_CONTINUATION_KEY,
  withFixedOutlineStart,
} from "../shared/workflow-outline";
import { assert, audit, id, now, requireRow } from "./common";
import { coordinatorSession } from "./preparation-service";
import { publishGroupMessage } from "./group-service";

const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const schema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(3000),
    steps: z
      .array(
        z
          .object({
            key,
            name: z.string().trim().min(1).max(100),
            objective: z.string().trim().min(1).max(2000),
            outputs: z
              .array(z.string().trim().min(1).max(300))
              .max(10)
              .default([]),
            dependsOn: z.array(key).max(40).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    questions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    previousId: z.uuid().optional(),
  })
  .strict();

export function migrateWorkflowOutlines(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=23")) return;
    s.db.exec(`
      CREATE TABLE workflow_outlines(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT NOT NULL REFERENCES sessions(id), message_id TEXT NOT NULL UNIQUE REFERENCES messages(id), previous_id TEXT UNIQUE REFERENCES workflow_outlines(id), revision INTEGER NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX outline_project ON workflow_outlines(project_id,created_at);
      CREATE TRIGGER outline_immutable_update BEFORE UPDATE ON workflow_outlines BEGIN SELECT RAISE(ABORT,'Outline revisions are immutable'); END;
      CREATE TRIGGER outline_immutable_delete BEFORE DELETE ON workflow_outlines BEGIN SELECT RAISE(ABORT,'Outline revisions are immutable'); END;
      INSERT INTO schema_migrations VALUES(23,datetime('now'));
    `);
  });
}

export function workflowOutlines(
  s: Store,
  p: string,
): (Row & { content: WorkflowOutline })[] {
  return s
    .all("SELECT * FROM workflow_outlines WHERE project_id=? ORDER BY rowid", p)
    .map((r) => ({ ...r, content: JSON.parse(String(r.content_json)) }));
}
export function workflowOutline(
  s: Store,
  p: string,
  outlineId: string,
): Row & { content: WorkflowOutline } {
  const row = requireRow(
    s.one(
      "SELECT * FROM workflow_outlines WHERE id=? AND project_id=?",
      outlineId,
      p,
    ),
    "流程大纲",
  );
  return { ...row, content: JSON.parse(String(row.content_json)) };
}

export function proposeWorkflowOutline(
  s: Store,
  p: string,
  sessionId: string,
  input: unknown,
  triggerId: string,
  promptVersion?: number,
) {
  const actor = coordinatorSession(s, p, sessionId);
  const { previousId, ...addition } = schema.parse(input);
  return s.transaction(() => {
    const latest = s.one(
      "SELECT id FROM workflow_outlines WHERE project_id=? ORDER BY rowid DESC LIMIT 1",
      p,
    );
    assert(
      !latest || previousId === latest.id,
      "请基于当前最新大纲传 previousId 续写，不能重新生成独立流程",
    );
    const previous = previousId ? workflowOutline(s, p, previousId) : null;
    const base = withFixedOutlineStart(previous?.content.steps ?? []);
    const existingKeys = new Set(base.map((step) => step.key));
    assert(
      addition.steps.every((step) => !existingKeys.has(step.key)),
      "只提交新增节点，不要重复或改写固定节点及已有节点",
    );
    assert(
      addition.steps.every(
        (step) =>
          !FIXED_OUTLINE_STEPS.some((fixed) => fixed.name === step.name),
      ),
      "固定环节由系统提供，不可重复生成总控、原文分析或编剧",
    );
    const ends = base
      .filter(
        (step) => !base.some((other) => other.dependsOn.includes(step.key)),
      )
      .map((step) => step.key);
    const content: WorkflowOutline = {
      ...addition,
      steps: [
        ...base,
        ...addition.steps.map((step) => ({
          ...step,
          dependsOn: step.dependsOn.length ? step.dependsOn : ends,
        })),
      ],
    };
    const keys = new Set(content.steps.map((step) => step.key));
    assert(keys.size === content.steps.length, "节点标识不能重复");
    const done = new Set<string>();
    for (const step of content.steps) {
      assert(
        new Set(step.dependsOn).size === step.dependsOn.length,
        "节点依赖不能重复",
      );
      assert(
        step.dependsOn.every((dep) => keys.has(dep) && dep !== step.key),
        "节点依赖不存在或指向自己",
      );
    }
    while (done.size < keys.size) {
      const ready = content.steps.filter(
        (step) =>
          !done.has(step.key) && step.dependsOn.every((dep) => done.has(dep)),
      );
      assert(
        ready.length > 0,
        "流程大纲不能包含循环依赖；分集重复请描述为可扩展步骤",
      );
      ready.forEach((step) => done.add(step.key));
    }
    const afterWriter = new Set([OUTLINE_CONTINUATION_KEY]);
    for (const stepKey of done) {
      const step = content.steps.find((s) => s.key === stepKey)!;
      if (step.dependsOn.some((dep) => afterWriter.has(dep)))
        afterWriter.add(stepKey);
      assert(
        FIXED_OUTLINE_KEYS.has(stepKey) || afterWriter.has(stepKey),
        "后续制作节点必须衔接在编剧之后",
      );
    }
    if (previousId)
      assert(
        !s.one(
          "SELECT 1 FROM workflow_outlines WHERE previous_id=?",
          previousId,
        ),
        "该大纲已有新版本，请基于最新版修改",
      );
    const outlineId = id(),
      messageId = id(),
      created = now();
    const revision = previous ? Number(previous.revision) + 1 : 1;
    s.run(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?)",
      messageId,
      sessionId,
      "agent",
      String(actor.agent.id),
      `我整理了《${content.title}》的流程大纲，供你查看和讨论。\n\n${content.summary}`,
      null,
      created,
    );
    if (promptVersion !== undefined)
      s.run(
        "INSERT INTO message_prompt_versions VALUES(?,?,?)",
        messageId,
        String(actor.agent.id),
        promptVersion,
      );
    s.run(
      "INSERT INTO workflow_outlines VALUES(?,?,?,?,?,?,?,?)",
      outlineId,
      p,
      sessionId,
      messageId,
      previousId ?? null,
      revision,
      JSON.stringify(content),
      created,
    );
    publishGroupMessage(s, p, sessionId, messageId, [], [], triggerId);
    audit(s, p, "workflow.outline_proposed", outlineId, {
      revision,
      previousId: previousId ?? null,
    });
    return {
      id: outlineId,
      messageId,
      revision,
      status: "draft",
      visibleInChat: true,
      title: content.title,
    };
  });
}

export const WORKFLOW_PLANNING_POLICY = `
# 制作流程规划
总控的重要目标是与用户共同制定适合当前作品的制作流程。了解原作概况和用户基本目标后，应先提出整体路线；用户问下一步或要求流程时，优先解释各阶段目标、依赖、交付物与需要用户参与的位置，不陷入镜头动作、画面参数等局部细节的反复追问。
固定起点始终是：总控（fixed_coordinator）→原文分析（fixed_source_analysis）→编剧（fixed_screenwriting），由系统提供。propose_workflow_outline 是续写接口：steps 只提交新增后续节点，不重复、改写或省去固定起点，也不重新生成已有节点。有大纲时先查 state / workflow_outline 最新版本，传 previousId；后台保留原有节点和依赖并追加，旧版本不改写。无前置的新增节点默认接到已有流程末端；显式 dependsOn 可引用已有节点或本次新节点，支持分支，但须衔接在编剧之后。首次续写可直接引用 fixed_screenwriting。该固定结构不代表三个 AI 必须同时入群，仍由总控按需调用。
根据故事类型、规模、已知偏好确定后续步骤：单条视觉短片可以不分集，长篇可先用可扩展的分集制作步骤说明后续逐集开展，不必提前穷举。交付物用自然语言写入 outputs。不确定的条件列为 questions，需要用户回答的独立问题另用 ask_confirmation 登记。固定环节始终保留，后续流程逐步续写。最新版本与历史版本分开查看，不把过期草案当当前计划。
大纲是待讨论的规划，不是已确认的制作任务，也不启动制作；只在接口确实完成时才声称正式流程已发布。用户确认后，继续按既有成果确认与流程接口落实；不能将上传资料或查看预览当成确认。
`;
