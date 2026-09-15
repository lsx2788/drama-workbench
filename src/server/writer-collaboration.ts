import { z } from "zod";
import { createHash } from "node:crypto";
import type { Store, Row } from "./db";
import { id, now, assert, requireRow, audit } from "./common";
import {
  createAgent,
  createSession,
  sessionInProject,
} from "./collaboration-service";
import { sessionProfile, preparationRecord } from "./preparation-service";

export function postAgentMessage(
  s: Store,
  p: string,
  toSessionId: string,
  input: unknown,
) {
  const d = z
    .object({ fromSessionId: z.uuid(), content: z.string().min(1).max(30000) })
    .strict()
    .parse(input);
  const from = sessionInProject(s, p, d.fromSessionId),
    to = sessionInProject(s, p, toSessionId);
  assert(from.status === "open" && to.status === "open", "会话已关闭");
  assert(
    s.one(
      "SELECT 1 FROM ai_relations WHERE (parent_id=? AND child_id=?) OR (parent_id=? AND child_id=?)",
      String(from.agent_id),
      String(to.agent_id),
      String(to.agent_id),
      String(from.agent_id),
    ),
    "仅允许已登记的上下级 AI 相互讨论；用户意见由总控转达",
  );
  return s.transaction(() => {
    const key = id();
    s.run(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?)",
      key,
      toSessionId,
      "agent",
      String(from.agent_id),
      d.content,
      null,
      now(),
    );
    const a = requireRow(
      s.one(
        "SELECT config_version FROM agents WHERE id=?",
        String(to.agent_id),
      ),
    );
    s.run(
      "INSERT INTO message_prompt_versions VALUES(?,?,?)",
      key,
      String(to.agent_id),
      Number(a.config_version),
    );
    return {
      message: s.one("SELECT * FROM messages WHERE id=?", key),
      delivery: "stored",
      execution: "not_configured",
    };
  });
}
export function delegateWriting(
  s: Store,
  p: string,
  input: unknown,
): Row & { execution: "not_configured" } {
  const d = z
    .object({
      parentSessionId: z.uuid(),
      requestKey: z.uuid(),
      name: z.string().min(1).max(100),
      objective: z.string().min(1).max(10000),
      sourceIds: z.array(z.uuid()).max(100).default([]),
      recordIds: z.array(z.uuid()).max(100).default([]),
      episodeIds: z.array(z.uuid()).max(100).default([]),
    })
    .strict()
    .parse(input);
  const parent = sessionProfile(s, p, d.parentSessionId);
  assert(
    parent.profile === "screenwriting",
    "只有编剧节点的 AI 可以在此委派编剧子任务",
  );
  const hash = createHash("sha256").update(JSON.stringify(d)).digest("hex");
  return s.transaction(() => {
    const old = s.one(
      "SELECT * FROM writer_delegations WHERE project_id=? AND request_key=?",
      p,
      d.requestKey,
    );
    if (old) {
      assert(old.request_hash === hash, "委派请求已改变，请使用新的请求编号");
      return { ...old, execution: "not_configured" };
    }
    for (const source of d.sourceIds)
      assert(
        s.one(
          "SELECT id FROM story_sources WHERE id=? AND project_id=?",
          source,
          p,
        ),
        "原作引用不属于当前项目",
      );
    for (const record of d.recordIds) preparationRecord(s, p, record);
    for (const episode of d.episodeIds)
      assert(
        s.one(
          "SELECT section_id FROM episode_entries WHERE section_id=? AND project_id=?",
          episode,
          p,
        ),
        "剧集引用不属于当前项目",
      );
    const child = createAgent(s, p, {
      nodeId: parent.session.node_id,
      name: d.name,
      purpose: "协助编剧处理明确范围的子任务",
      instructions: `## 身份\n你是当前编剧的协作 AI。\n## 本次目标\n${d.objective}\n## 交付要求\n向上级编剧反馈结论、依据、覆盖范围和问题；根据任务保存成果，只返回必要引用。不得越过已确认改编范围或提前生成分集剧本。`,
      tools: JSON.parse(String(parent.agent.tools_json)),
    });
    s.run(
      "INSERT INTO ai_relations VALUES(?,?)",
      String(child.id),
      String(parent.agent.id),
    );
    const ss = createSession(s, p, { agentId: child.id, title: d.name });
    const refs = {
      sourceIds: d.sourceIds,
      recordIds: d.recordIds,
      episodeIds: d.episodeIds,
    };
    const key = id();
    s.run(
      "INSERT INTO writer_delegations VALUES(?,?,?,?,?,?,?,?,?)",
      key,
      p,
      d.requestKey,
      hash,
      d.parentSessionId,
      String(ss.id),
      d.objective,
      JSON.stringify(refs),
      now(),
    );
    postAgentMessage(s, p, String(ss.id), {
      fromSessionId: d.parentSessionId,
      content: `## 本次任务\n${d.objective}\n\n## 输入引用\n${JSON.stringify(refs)}\n\n## 反馈\n有疑问向上级编剧讨论，汇报成果编号、范围和问题。`,
    });
    audit(s, p, "writer.delegation_registered", key, {
      parentId: parent.agent.id,
      childId: child.id,
    });
    return {
      ...s.one("SELECT * FROM writer_delegations WHERE id=?", key),
      execution: "not_configured",
    };
  });
}
