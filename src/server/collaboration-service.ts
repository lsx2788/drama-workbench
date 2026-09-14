import type { Store } from "./db";
import { id, now, requireRow, nodeInProject, assert, audit } from "./common";
import {
  agentSchema,
  sessionSchema,
  messageSchema,
  highlightSchema,
  skillSchema,
} from "./schemas";

export function agentInProject(s: Store, p: string, key: string) {
  return requireRow(
    s.one(
      "SELECT a.*,n.node_type FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE a.id=? AND w.project_id=?",
      key,
      p,
    ),
    "AI",
  );
}
export function sessionInProject(s: Store, p: string, key: string) {
  return requireRow(
    s.one(
      "SELECT ss.*,n.node_type,a.name AS agent_name,a.node_id FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE ss.id=? AND w.project_id=?",
      key,
      p,
    ),
    "会话",
  );
}
function messageInProject(s: Store, p: string, key: string) {
  return requireRow(
    s.one(
      "SELECT m.*,a.node_id FROM messages m JOIN sessions ss ON ss.id=m.session_id JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE m.id=? AND w.project_id=?",
      key,
      p,
    ),
    "源消息",
  );
}
export function createAgent(s: Store, p: string, input: unknown) {
  const d = agentSchema.parse(input);
  nodeInProject(s, p, d.nodeId);
  const key = id();
  s.run(
    "INSERT INTO agents VALUES(?,?,?,?,?,?,?,?,?,?)",
    key,
    d.nodeId,
    d.name,
    d.purpose,
    d.instructions,
    d.provider,
    d.model,
    1,
    JSON.stringify(d.tools),
    now(),
  );
  return agentInProject(s, p, key);
}
export function createSession(s: Store, p: string, input: unknown) {
  const d = sessionSchema.parse(input),
    agent = agentInProject(s, p, d.agentId),
    key = id();
  if (d.predecessorId)
    assert(
      sessionInProject(s, p, d.predecessorId).agent_id === d.agentId,
      "接续会话必须属于同一 AI",
    );
  s.run(
    "INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)",
    key,
    d.agentId,
    d.title,
    String(agent.provider),
    d.externalSessionId ?? null,
    d.predecessorId ?? null,
    "open",
    now(),
  );
  return sessionInProject(s, p, key);
}
export function postHumanMessage(
  s: Store,
  p: string,
  sessionId: string,
  input: unknown,
) {
  const d = messageSchema.parse(input),
    ss = sessionInProject(s, p, sessionId);
  assert(
    ss.node_type === "coordinator",
    "当前个人模式只能向总控发送消息",
    "HUMAN_CHILD_MESSAGE_DENIED",
  );
  assert(ss.status === "open", "会话已关闭");
  if (d.quoteId) messageInProject(s, p, d.quoteId);
  const key = id();
  s.run(
    "INSERT INTO messages VALUES(?,?,?,?,?,?,?)",
    key,
    sessionId,
    "human",
    "local-user",
    d.content,
    d.quoteId ?? null,
    now(),
  );
  return {
    message: s.one("SELECT * FROM messages WHERE id=?", key),
    delivery: "stored",
    execution: "not_configured",
  };
}
export function createHighlight(s: Store, p: string, input: unknown) {
  const d = highlightSchema.parse(input);
  nodeInProject(s, p, d.nodeId);
  if (d.sourceMessageId)
    assert(
      messageInProject(s, p, d.sourceMessageId).node_id === d.nodeId,
      "重点来源必须属于本节点的讨论",
    );
  return s.transaction(() => {
    if (d.supersedesId) {
      const old = requireRow(
        s.one(
          "SELECT * FROM highlights WHERE id=? AND node_id=?",
          d.supersedesId,
          d.nodeId,
        ),
        "原重点",
      );
      assert(old.status !== "superseded", "该重点已经被替代");
      assert(d.status === "confirmed", "替代有效重点需要明确确认");
      s.run(
        "UPDATE highlights SET status='superseded' WHERE id=?",
        d.supersedesId,
      );
    }
    const key = id();
    s.run(
      "INSERT INTO highlights VALUES(?,?,?,?,?,?,?,?,?,?)",
      key,
      d.nodeId,
      d.kind,
      d.status,
      d.content,
      d.rationale,
      d.sourceMessageId ?? null,
      d.supersedesId ?? null,
      "local-user",
      now(),
    );
    audit(s, p, "highlight.recorded", key, { status: d.status });
    return s.one("SELECT * FROM highlights WHERE id=?", key);
  });
}
export function confirmHighlight(s: Store, p: string, key: string) {
  const h = requireRow(
    s.one(
      "SELECT h.* FROM highlights h JOIN nodes n ON n.id=h.node_id JOIN workflows w ON w.id=n.workflow_id WHERE h.id=? AND w.project_id=?",
      key,
      p,
    ),
    "重点",
  );
  assert(h.status === "proposed", "只有提议可以确认");
  s.run("UPDATE highlights SET status='confirmed' WHERE id=?", key);
  audit(s, p, "highlight.confirmed", key);
  return s.one("SELECT * FROM highlights WHERE id=?", key);
}
export function registerSkill(s: Store, input: unknown) {
  const d = skillSchema.parse(input);
  assert(
    !s.one("SELECT id FROM skills WHERE id=?", d.id),
    "Skill ID 已存在；新版本请登记新 ID",
  );
  s.run(
    "INSERT INTO skills VALUES(?,?,?,?,?)",
    d.id,
    d.name,
    d.version,
    d.description,
    d.capability,
  );
  return s.one("SELECT * FROM skills WHERE id=?", d.id);
}
export function bindSkill(
  s: Store,
  p: string,
  agentId: string,
  skillId: string,
) {
  const a = agentInProject(s, p, agentId),
    skill = requireRow(
      s.one("SELECT * FROM skills WHERE id=?", skillId),
      "Skill",
    );
  const allowed = JSON.parse(String(a.tools_json)) as string[];
  assert(
    allowed.includes(String(skill.capability)),
    "该 AI 未获准使用此能力类别",
    "CAPABILITY_DENIED",
  );
  s.run("INSERT OR IGNORE INTO agent_skills VALUES(?,?)", agentId, skillId);
  return s.all(
    "SELECT s.* FROM skills s JOIN agent_skills b ON b.skill_id=s.id WHERE b.agent_id=?",
    agentId,
  );
}
