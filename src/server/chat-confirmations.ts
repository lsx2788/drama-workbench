import { z } from "zod";
import type { Store } from "./db";
import { assert, audit, id, now, projectExists, requireRow } from "./common";
import { coordinatorSession } from "./preparation-service";
import { publishGroupMessage } from "./group-service";

export function chatConfirmations(s: Store, p: string, groupId?: string) {
  projectExists(s, p);
  if (groupId) coordinatorSession(s, p, groupId);
  return s.all(
    "SELECT * FROM chat_confirmations WHERE project_id=? AND (? IS NULL OR group_id=?) ORDER BY rowid",
    p,
    groupId ?? null,
    groupId ?? null,
  );
}

const questionSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(6000),
  })
  .strict();

/** One explicit question produces one canonical group message, never inferred from prose. */
export function askConfirmation(
  s: Store,
  p: string,
  sessionId: string,
  input: unknown,
  triggerId: string,
  promptVersion?: number,
) {
  const actor = coordinatorSession(s, p, sessionId);
  const d = questionSchema.parse(input);
  return s.transaction(() => {
    const existing = s.one(
      "SELECT * FROM chat_confirmations WHERE group_id=? AND request_key=?",
      sessionId,
      d.key,
    );
    if (existing) {
      const message = s.one(
        "SELECT content FROM messages WHERE id=?",
        String(existing.message_id),
      )!;
      assert(
        existing.title === d.title && message.content === d.content,
        "此问题标识已使用，请读取原问题或使用新标识",
      );
      return existing;
    }
    const questionId = id(),
      messageId = id(),
      created = now();
    s.run(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?)",
      messageId,
      sessionId,
      "agent",
      String(actor.agent.id),
      d.content,
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
    publishGroupMessage(s, p, sessionId, messageId, [], [], triggerId);
    s.run(
      "INSERT INTO chat_confirmations(id,project_id,group_id,message_id,request_key,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)",
      questionId,
      p,
      sessionId,
      messageId,
      d.key,
      d.title,
      created,
      created,
    );
    audit(s, p, "chat.confirmation_requested", questionId, {
      messageId,
      sessionId,
    });
    return requireRow(
      s.one("SELECT * FROM chat_confirmations WHERE id=?", questionId),
    );
  });
}

function scoped(s: Store, p: string, key: string) {
  projectExists(s, p);
  return requireRow(
    s.one(
      "SELECT * FROM chat_confirmations WHERE id=? AND project_id=?",
      key,
      p,
    ),
    "待确认问题",
  );
}

export function skipConfirmation(
  s: Store,
  p: string,
  key: string,
  input: unknown,
) {
  z.object({ confirm: z.literal(true) })
    .strict()
    .parse(input);
  return s.transaction(() => {
    const q = scoped(s, p, key);
    if (q.status === "skipped") return q;
    assert(q.status === "pending", "问题状态已更新，请刷新列表");
    s.run(
      "UPDATE chat_confirmations SET status='skipped',updated_at=? WHERE id=?",
      now(),
      key,
    );
    audit(s, p, "chat.confirmation_skipped", key, {
      actor: "local-user",
      approvalGranted: false,
    });
    return scoped(s, p, key);
  });
}

/** Answering a question never approves a production result. */
export function resolveConfirmation(
  s: Store,
  p: string,
  sessionId: string,
  input: unknown,
) {
  coordinatorSession(s, p, sessionId);
  const d = z
    .object({
      id: z.uuid(),
      userMessageId: z.uuid(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(input);
  return s.transaction(() => {
    const q = scoped(s, p, d.id);
    assert(q.group_id === sessionId, "只能处理当前群的问题");
    if (q.status === "answered") {
      assert(
        q.response_message_id === d.userMessageId && q.resolution === d.reason,
        "此问题已有处理结果",
      );
      return q;
    }
    assert(q.status === "pending", "问题已跳过，不能把跳过视作用户确认");
    assert(
      s.one(
        "SELECT m.id FROM messages m JOIN group_messages g ON g.message_id=m.id WHERE m.id=? AND m.sender_type='human' AND g.group_id=? AND m.rowid>(SELECT rowid FROM messages WHERE id=?)",
        d.userMessageId,
        sessionId,
        String(q.message_id),
      ),
      "需引用提问之后当前群的真实用户回复",
    );
    s.run(
      "UPDATE chat_confirmations SET status='answered',response_message_id=?,resolution=?,updated_at=? WHERE id=?",
      d.userMessageId,
      d.reason,
      now(),
      d.id,
    );
    audit(s, p, "chat.confirmation_answered", d.id, {
      sessionId,
      userMessageId: d.userMessageId,
      approvalGranted: false,
    });
    return scoped(s, p, d.id);
  });
}
