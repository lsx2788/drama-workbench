import type { Store } from "./db";
import { audit, now } from "./common";

/** Called inside the human-message transaction: a saved reply clears only its quoted question. */
export function confirmQuotedQuestion(s: Store, p: string, messageId: string) {
  const question = s.one(
    "SELECT q.id FROM messages m JOIN chat_confirmations q ON q.message_id=m.quote_id AND q.group_id=m.session_id WHERE m.id=? AND m.sender_type='human' AND q.project_id=? AND q.status IN ('pending','skipped') AND m.rowid>(SELECT rowid FROM messages WHERE id=q.message_id)",
    messageId,
    p,
  );
  if (!question) return;
  s.run(
    "UPDATE chat_confirmations SET status='answered',response_message_id=?,resolution=?,updated_at=? WHERE id=?",
    messageId,
    "用户已回复此问题，自动完成确认提醒",
    now(),
    String(question.id),
  );
  audit(s, p, "chat.confirmation_answered", String(question.id), {
    actor: "local-user",
    userMessageId: messageId,
    automatic: true,
    approvalGranted: false,
  });
}
