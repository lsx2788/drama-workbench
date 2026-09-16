import type { Store, Row } from "./db";
import { assert, now, requireRow } from "./common";
import { sessionInProject } from "./collaboration-service";

export const SILENT_REPLY = "[[WORKBENCH_SILENT]]";
export const GROUP_POLICY = `
# 群聊通信规则（优先于旧的仅总控转达规则）
## 身份与投递
当前是用户、总控与专业 AI 的讨论群。每条输入的真实发送者、接收者、@ 提及及消息 ID 由服务器标注，user 技术角色不代表都是用户本人。用户未 @ 时仅投递给总控，不自动转发原作分析 AI；总控只在确有子任务需要时主动委派。用户可直接 @ 专业 AI，同一原始消息也投递给总控；不得把用户发言描述成总控任务。AI 的回复以自身身份出现在群里，禁止冒充用户或其他 AI。
## 讨论与静默
通过 ask_child 发给子 AI 的内容也会作为你的群消息展示；用真实会话 ID，避免重复转发已经 @ 到并回答过的问题。总控收到用户或子 AI 发言后按需要补充；若已有回答充分或仅需旁听，最终仅回复 ${SILENT_REPLY}，不要附加文字、不要为表态而重复答案。此标记仅限总控，本轮会记为静默而不会显示气泡。用户明确需要总控回答、确认或处理阻塞时应正常回答。专业 AI 回答用户 @ 问题也必须遵守原有职责和定稿权限，不擅自确认需求或跨阶段推进。
## 会话生命周期
总控可用 group_members 查询真实会话和参与状态。当前环节完成、不再需要某个 AI 时，在其任务返回后用 group_member 将其设为 paused，保留会话与历史；后续需要继续沟通时将同一会话设为 active，不为重新加入而重建 AI。退出成员不再接收 @ 或新的委派。不要为了旁听而让所有 AI 自动回复。
`;

export function ensureGroup(s: Store, p: string, groupId: string) {
  const root = sessionInProject(s, p, groupId);
  assert(root.node_type === "coordinator", "群聊必须挂在总控会话下");
  s.run("INSERT OR IGNORE INTO chat_groups VALUES(?,?,?)", groupId, p, now());
  s.run(
    "INSERT OR IGNORE INTO group_members(group_id,session_id,joined_at) VALUES(?,?,?)",
    groupId,
    groupId,
    now(),
  );
  return root;
}
/** Candidates are existing open descendant sessions, never arbitrary project agents. */
export function groupCandidates(s: Store, p: string, groupId: string) {
  const root = sessionInProject(s, p, groupId);
  assert(root.node_type === "coordinator", "此会话不是总控群聊");
  return s.all(
    `WITH RECURSIVE tree(id) AS (SELECT ? UNION SELECT r.child_id FROM ai_relations r JOIN tree t ON r.parent_id=t.id)
    SELECT ss.id,ss.title,ss.status,ss.external_session_id,a.id AS agent_id,a.name,n.node_type,COALESCE(gm.status,'active') AS membership_status FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN tree t ON t.id=a.id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id LEFT JOIN group_members gm ON gm.session_id=ss.id AND gm.group_id=?
    WHERE w.project_id=? AND ss.status='open' AND (ss.id=? OR a.id<>?) ORDER BY a.created_at,ss.created_at`,
    String(root.agent_id),
    groupId,
    p,
    groupId,
    String(root.agent_id),
  );
}
export function addGroupMember(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
) {
  ensureGroup(s, p, groupId);
  assert(
    groupCandidates(s, p, groupId).some(
      (r) => r.id === sessionId && r.membership_status === "active",
    ),
    "被提及的 AI 不在当前讨论中，请先重新加入",
  );
  s.run(
    "INSERT OR IGNORE INTO group_members(group_id,session_id,joined_at) VALUES(?,?,?)",
    groupId,
    sessionId,
    now(),
  );
}
export function setGroupMember(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
  status: "active" | "paused",
  fromRuntime = false,
) {
  ensureGroup(s, p, groupId);
  assert(sessionId !== groupId, "总控不能退出自己的群聊");
  assert(
    groupCandidates(s, p, groupId).some((r) => r.id === sessionId),
    "此 AI 不属于当前群的协作范围",
  );
  if (!fromRuntime)
    assert(
      !s.one(
        "SELECT 1 FROM ai_turns WHERE session_id=? AND status IN ('queued','running')",
        groupId,
      ),
      "请等本轮讨论结束再调整成员",
    );
  s.run(
    "INSERT INTO group_members VALUES(?,?,?,?) ON CONFLICT(group_id,session_id) DO UPDATE SET status=excluded.status",
    groupId,
    sessionId,
    now(),
    status,
  );
  return { sessionId, status, historyPreserved: true };
}
/** One canonical message, with independently pinned recipient deliveries. */
export function publishGroupMessage(
  s: Store,
  p: string,
  groupId: string,
  messageId: string,
  recipients: string[],
  mentions: string[] = [],
  replyTo?: string,
) {
  return s.transaction(() => {
    ensureGroup(s, p, groupId);
    const message = requireRow(
      s.one("SELECT * FROM messages WHERE id=?", messageId),
      "消息",
    );
    sessionInProject(s, p, String(message.session_id));
    const old = s.one(
      "SELECT group_id FROM group_messages WHERE message_id=?",
      messageId,
    );
    assert(!old || old.group_id === groupId, "不能将其他群的消息重新发布");
    if (replyTo) {
      const ref = requireRow(
        s.one(
          "SELECT group_id FROM group_messages WHERE message_id=?",
          replyTo,
        ),
        "回复消息",
      );
      assert(ref.group_id === groupId, "回复目标不属于当前群");
    }
    s.run(
      "INSERT OR IGNORE INTO group_messages VALUES(?,?,?)",
      messageId,
      groupId,
      replyTo ?? null,
    );
    for (const recipient of new Set([groupId, ...recipients])) {
      addGroupMember(s, p, groupId, recipient);
      const ss = sessionInProject(s, p, recipient);
      const version = Number(
        requireRow(
          s.one(
            "SELECT config_version FROM agents WHERE id=?",
            String(ss.agent_id),
          ),
        ).config_version,
      );
      s.run(
        "INSERT OR IGNORE INTO group_deliveries VALUES(?,?,?,?)",
        messageId,
        recipient,
        mentions.includes(recipient) ? 1 : 0,
        version,
      );
    }
  });
}
export function groupEnvelope(
  s: Store,
  messageId: string,
): (Row & { recipients: Row[] }) | null {
  const row = s.one(
    "SELECT gm.*,m.sender_type,m.sender_id,a.name AS sender_name FROM group_messages gm JOIN messages m ON m.id=gm.message_id LEFT JOIN agents a ON a.id=m.sender_id AND m.sender_type='agent' WHERE gm.message_id=?",
    messageId,
  );
  if (!row) return null;
  const recipients = s.all(
    "SELECT d.*,a.name FROM group_deliveries d JOIN sessions ss ON ss.id=d.session_id JOIN agents a ON a.id=ss.agent_id WHERE d.message_id=?",
    messageId,
  );
  return { ...row, recipients };
}
export function groupInputLabel(s: Store, messageId: string) {
  const group = groupEnvelope(s, messageId);
  if (!group) return "";
  return `\n[群 ${group.group_id}; 真实发送者：${group.sender_type === "human" ? "用户本人" : `${group.sender_name}（AI，${group.sender_id}）`}; 接收者：${group.recipients.map((r) => `${r.name}${r.mentioned ? "（@提及）" : ""}`).join("、")}; 回复消息：${group.reply_to_id ?? "无"}]`;
}
