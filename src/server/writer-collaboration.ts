import { z } from "zod";
import { authorizeChildMessage } from "./child-authorization";
import { groupCandidates } from "./group-service";
import type { Store, Row } from "./db";
import { id, now, assert, requireRow } from "./common";
import { sessionInProject } from "./collaboration-service";

export function postAgentMessage(
  s: Store,
  p: string,
  toSessionId: string,
  input: unknown,
) {
  const d = z
    .object({
      fromSessionId: z.uuid(),
      content: z.string().min(1).max(30000),
      authorizationCode: z.string().optional(),
    })
    .strict()
    .parse(input);
  const from = sessionInProject(s, p, d.fromSessionId),
    to = sessionInProject(s, p, toSessionId);
  assert(from.status === "open" && to.status === "open", "会话已关闭");
  assert(
    (from.node_type === "coordinator" &&
      groupCandidates(s, p, d.fromSessionId).some(
        (r) => r.id === toSessionId && toSessionId !== d.fromSessionId,
      )) ||
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
    if (
      s.one(
        "SELECT 1 FROM ai_relations WHERE parent_id=? AND child_id=?",
        String(from.agent_id),
        String(to.agent_id),
      )
    )
      authorizeChildMessage(
        s,
        p,
        d.fromSessionId,
        toSessionId,
        d.authorizationCode,
        undefined,
        true,
      );
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
/** Legacy endpoint is intentionally closed: use the coordinator authorization flow. */
export function delegateWriting(_s: Store, _p: string, _input: unknown): Row {
  throw new Error(
    "编剧创建下级需先申请总控授权，再通过 create_child 创建；旧委派入口已停用",
  );
}
