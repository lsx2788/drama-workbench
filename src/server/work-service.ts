import type { Store } from "./db";
import { promptSettings } from "./agent-prompt-service";
import { assertDeliveryReady } from "./workflow-structure";
import { id, now, requireRow, nodeInProject, assert, audit } from "./common";
import { agentInProject, sessionInProject } from "./collaboration-service";
import { versionInProject } from "./asset-service";
import { itemSchema, itemStateSchema, runSchema } from "./schemas";

export function itemInProject(s: Store, p: string, key: string) {
  return requireRow(
    s.one(
      "SELECT i.* FROM items i JOIN nodes n ON n.id=i.node_id JOIN workflows w ON w.id=n.workflow_id WHERE i.id=? AND w.project_id=?",
      key,
      p,
    ),
    "事项",
  );
}
function assertNodeCanProgress(s: Store, nodeId: string) {
  assertDeliveryReady(s, nodeId);
  assert(
    s.one(
      "SELECT n.id FROM nodes n JOIN workflows w ON w.id=n.workflow_id WHERE n.id=? AND w.status='active' AND n.status NOT IN ('blocked','completed')",
      nodeId,
    ),
    "事项所属流程未发布或节点不可推进",
  );
  assert(
    !s.one(
      "SELECT d.depends_on FROM node_dependencies d JOIN nodes n ON n.id=d.depends_on WHERE d.node_id=? AND n.status<>'completed'",
      nodeId,
    ),
    "前置节点尚未完成",
  );
}
export function createItem(s: Store, p: string, input: unknown) {
  const d = itemSchema.parse(input);
  nodeInProject(s, p, d.nodeId);
  if (d.agentId)
    assert(
      agentInProject(s, p, d.agentId).node_id === d.nodeId,
      "执行 AI 必须属于本节点",
    );
  for (const key of d.dependencies) itemInProject(s, p, key);
  for (const key of d.inputs)
    assert(
      versionInProject(s, p, key).status === "approved",
      "事项输入必须是已定稿版本",
    );
  return s.transaction(() => {
    const key = id();
    s.run(
      "INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?)",
      key,
      d.nodeId,
      d.title,
      d.objective,
      "planned",
      d.owner,
      d.agentId ?? null,
      d.acceptance,
      "",
      now(),
    );
    for (const dep of new Set(d.dependencies))
      s.run("INSERT INTO item_dependencies VALUES(?,?)", key, dep);
    for (const asset of new Set(d.inputs))
      s.run("INSERT INTO asset_usages VALUES(?,?)", key, asset);
    return itemInProject(s, p, key);
  });
}
export function setItemState(s: Store, p: string, key: string, input: unknown) {
  const d = itemStateSchema.parse(input),
    item = itemInProject(s, p, key);
  assert(item.status !== "running", "运行中的事项应由执行器更新");
  if (["ready", "review", "completed"].includes(d.status)) {
    assertNodeCanProgress(s, String(item.node_id));
    assert(
      !s.one(
        "SELECT d.depends_on FROM item_dependencies d JOIN items i ON i.id=d.depends_on WHERE d.item_id=? AND i.status<>'completed'",
        key,
      ),
      "前置事项尚未完成",
    );
  }
  if (d.status === "blocked") assert(d.reason.trim(), "阻塞必须说明原因");
  if (d.status === "completed")
    assert(d.reason.trim(), "完成事项需记录交付或验收依据");
  if (item.status === "completed" && d.status !== "completed")
    assert(
      !s.one(
        "SELECT i.id FROM item_dependencies d JOIN items i ON i.id=d.item_id WHERE d.depends_on=? AND i.status IN ('ready','running','review','completed')",
        key,
      ),
      "已有下游推进，请先处理依赖",
    );
  s.run(
    "UPDATE items SET status=?,block_reason=? WHERE id=?",
    d.status,
    d.reason,
    key,
  );
  audit(s, p, "item.state", key, d);
  return itemInProject(s, p, key);
}
export function contextForItem(s: Store, p: string, key: string) {
  const item = itemInProject(s, p, key),
    node = nodeInProject(s, p, String(item.node_id));
  const agent = item.agent_id
    ? agentInProject(s, p, String(item.agent_id))
    : null;
  return {
    item,
    node,
    agent,
    prompt: agent ? promptSettings(s, p, String(agent.id)).current : null,
    highlights: s.all(
      "SELECT * FROM highlights WHERE node_id=? AND status='confirmed' ORDER BY created_at",
      String(item.node_id),
    ),
    inputs: s
      .all(
        "SELECT v.*,a.code,a.name FROM asset_usages u JOIN asset_versions v ON v.id=u.version_id JOIN assets a ON a.id=v.asset_id WHERE u.item_id=?",
        key,
      )
      .map((v) => ({
        ...v,
        files: s
          .all(
            "SELECT id,original_name,mime,sha256 FROM files WHERE version_id=?",
            String(v.id),
          )
          .map((f) => ({ ...f, url: `/api/v1/projects/${p}/files/${f.id}` })),
      })),
    skills: agent
      ? s.all(
          "SELECT sk.* FROM skills sk JOIN agent_skills b ON b.skill_id=sk.id WHERE b.agent_id=?",
          String(agent.id),
        )
      : [],
  };
}
export function prepareRun(s: Store, p: string, input: unknown) {
  const d = runSchema.parse(input),
    item = itemInProject(s, p, d.itemId),
    ss = sessionInProject(s, p, d.sessionId);
  return s.transaction(() => {
    const existing = s.one(
      "SELECT * FROM runs WHERE idempotency_key=?",
      d.idempotencyKey,
    );
    if (existing) {
      assert(
        existing.item_id === d.itemId && existing.session_id === d.sessionId,
        "幂等键已用于其他请求",
      );
      return existing;
    }
    assert(item.agent_id === ss.agent_id, "会话 AI 与事项执行者不匹配");
    assert(item.status === "ready", "事项需准备就绪才能请求执行");
    assertNodeCanProgress(s, String(item.node_id));
    assert(
      !s.one(
        "SELECT d.depends_on FROM item_dependencies d JOIN items i ON i.id=d.depends_on WHERE d.item_id=? AND i.status<>'completed'",
        d.itemId,
      ),
      "前置事项未完成",
    );
    const context = contextForItem(s, p, d.itemId),
      key = id(),
      time = now();
    const error =
      "尚未接入真实 AI 执行器；已保存输入与配置快照，未提交任何外部调用。";
    s.run(
      "INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      key,
      d.itemId,
      d.sessionId,
      d.idempotencyKey,
      "blocked",
      JSON.stringify({
        agent: context.agent,
        skills: context.skills,
        prompt: context.prompt,
      }),
      JSON.stringify(context),
      error,
      null,
      time,
      time,
    );
    s.run(
      "UPDATE items SET status='blocked',block_reason=? WHERE id=?",
      error,
      d.itemId,
    );
    audit(s, p, "run.blocked", key);
    return s.one("SELECT * FROM runs WHERE id=?", key);
  });
}
