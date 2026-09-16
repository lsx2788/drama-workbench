import type { Store } from "./db";
import { now, audit } from "./common";

export const CONFIRMATION_POLICY = `## 用户待确认问题
需要用户确认需求、取舍或补充关键信息时，总控必须调用 ask_confirmation，将问题保存并作为黄色群消息展示。每个可独立回答的问题单独登记，title 是简短摘要，content 是自然语言问题，可说明背景，但不生成选项按钮。key 是当前群唯一的问题标识，重试使用同一标识；不要重复登记已存在的问题，也不要在最终回复里重复一遍同样的问题。子 AI 需要用户决策时请先交给总控梳理。
每轮通过 confirmations 查询当前群的问题及状态。用户点击黄色消息只是引用，不表示同意；发送引用回复也不自动审批或消除问题。总控读懂用户真实回复后，若问题已得到回答，调用 resolve_confirmation，引用本群提问之后的 userMessageId 并写明依据；部分回答、反问或仍有歧义时保持 pending，继续澄清。普通回复也可能回答先前问题，不强制要求用户引用。
skipped 仅表示用户主动跳过提醒，不是同意、不是成果可用，也不得替用户作决定。后续确实被该问题阻塞时说明原因，再提出必要的新问题，不要机械重建所有跳过项。answered 仅表示问题已回应，不代表用户赞成提议；需求、框架与资产仍分别走真实审核接口。问答状态、成果审核、生产资格彼此独立。历史聊天不根据问号或关键词自动补标。`;

export function migrateChatConfirmations(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=26")) return;
    s.db.exec(`CREATE TABLE chat_confirmations(
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      group_id TEXT NOT NULL REFERENCES sessions(id), message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
      request_key TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','answered','skipped')),
      response_message_id TEXT REFERENCES messages(id), resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(group_id,request_key));
      CREATE INDEX confirmation_group_status ON chat_confirmations(group_id,status);`);
    upgradeConfirmationPolicy(
      s,
      (instructions) => `${instructions}\n\n${CONFIRMATION_POLICY}`,
      true,
    );
    s.run("INSERT INTO schema_migrations VALUES(26,datetime('now'))");
  });
}

function upgradeConfirmationPolicy(
  s: Store,
  instructions: (old: string) => string,
  addTool = false,
) {
  const policy = s.one(
    "SELECT * FROM system_ai_policies WHERE id='coordinator' ORDER BY version DESC LIMIT 1",
  )!;
  const policyVersion = Number(policy.version) + 1;
  const tools = JSON.parse(String(policy.required_tools_json));
  if (addTool)
    tools.push({
      id: "system.user-confirmation",
      name: "用户待确认问题",
      status: "available",
    });
  s.run(
    "INSERT INTO system_ai_policies VALUES(?,?,?,?,?)",
    "coordinator",
    policyVersion,
    instructions(String(policy.instructions)),
    JSON.stringify(tools),
    String(policy.required_skills_json),
  );
  for (const agent of s.all(
    "SELECT a.id,a.config_version,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id JOIN agent_config_layers l ON l.agent_id=a.id AND l.version=a.config_version WHERE l.policy_id='coordinator'",
  )) {
    const version = Number(agent.config_version) + 1;
    s.run(
      "INSERT INTO agent_prompt_versions SELECT id,?,instructions,?,'updated' FROM agents WHERE id=?",
      version,
      now(),
      String(agent.id),
    );
    s.run(
      "INSERT INTO agent_config_layers SELECT agent_id,?,policy_id,?,optional_tools_json,optional_skills_json,allowed_tools_json FROM agent_config_layers WHERE agent_id=? AND version=?",
      version,
      policyVersion,
      String(agent.id),
      Number(agent.config_version),
    );
    s.run(
      "UPDATE agents SET config_version=? WHERE id=?",
      version,
      String(agent.id),
    );
    audit(
      s,
      String(agent.project_id),
      "agent.confirmation_policy",
      String(agent.id),
      { version },
    );
  }
}

export const REPLY_CONFIRMATION_POLICY = CONFIRMATION_POLICY.replace(
  "每轮通过 confirmations 查询当前群的问题及状态。用户点击黄色消息只是引用，不表示同意；发送引用回复也不自动审批或消除问题。总控读懂用户真实回复后，若问题已得到回答，调用 resolve_confirmation，引用本群提问之后的 userMessageId 并写明依据；部分回答、反问或仍有歧义时保持 pending，继续澄清。普通回复也可能回答先前问题，不强制要求用户引用。",
  "每轮通过 confirmations 查询当前群的问题及状态。用户点击黄色消息只是引用；用户引用问题并成功发送回复后，系统立即将对应问题标为 answered 并移出待确认清单，无需等待总控判断或调用工具。不要将已回复问题继续保留为 pending；如确实需要澄清，另提一个具体的新问题。用户已跳过的问题随后收到明确引用回复，也会标为 answered。普通未引用消息不会自动清除其他问题；总控若识别其中回答了某个问题，可用 resolve_confirmation 引用真实用户消息补充关联。answered 只表示已回复，回复的同意、反对或修改意见应按用户原意理解，不能将任何回复一概当作同意或成果审核通过。",
);

export function migrateReplyConfirmations(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=27")) return;
    upgradeConfirmationPolicy(s, (instructions) =>
      instructions.replace(CONFIRMATION_POLICY, REPLY_CONFIRMATION_POLICY),
    );
    s.run("INSERT INTO schema_migrations VALUES(27,datetime('now'))");
  });
}
