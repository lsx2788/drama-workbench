import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store, Row } from "./db";
import { assert, audit, id, now, requireRow, nodeInProject } from "./common";
import {
  createAgent,
  createSession,
  sessionInProject,
} from "./collaboration-service";
import { createNode } from "./project-service";
import { coordinatorSession } from "./preparation-service";
import {
  groupCandidates,
  publishGroupMessage,
  setGroupMember,
} from "./group-service";

const specification = z
  .object({
    name: z.string().trim().min(1).max(100),
    objective: z.string().trim().min(1).max(200),
    instructions: z.string().trim().max(10000).default(""),
    nodeId: z.uuid().optional(),
    childSessionId: z.uuid().optional(),
  })
  .strict();

export const CHILD_AUTHORIZATION_POLICY = `
# 下级 AI 创建与通信授权（覆盖旧的编剧自由委派规则）
总控可用 create_child 按需创建任意专业名称的子 AI，定义目标及内容提示词；系统规则和工具权限由平台决定。既有原作分析、编剧仍可用 prepare。创建不是执行，随后 ask_child 才发任务。
其他 AI 如需下级协助，先 request_child_authorization 提出明确名称、目标、内容提示词、理由；已有下级可带 childSessionId 申请继续协作。申请、审批、创建和撤销会自动进入总控群，不要重复发申请或把授权码写到聊天。提交申请后返回“等待总控授权”及简短理由，让本次调用结束，不循环等待或调用正在运行的总控。
总控收到申请后用 child_authorizations 查看，review_child_authorization 批准或拒绝并说明原因。批准限制一个指定子 AI、有效期及调用次数，不批准无限扩展；批准后 ask_child 通知申请者查询授权并继续。申请者用 child_authorizations 获取自己的授权码，create_child 只传 key 和 authorizationCode，后台按已批准的内容创建；随后每次 ask_child 必须带 authorizationCode。授权不能转借、扩大任务、替换目标或传给子 AI 再用。下级若还需下级，独立申请总控。
创建时 key 保持稳定，重试不会重复创建。无授权、过期、撤销、跨群、错目标或次数耗尽时不能转发任务。总控可以 revoke_child_authorization 撤销授权；已存历史与会话不删除。普通用户消息不视为授权码。child_authorizations 同时返回申请状态；总控不得仅聊天说同意而不调用审批工具。`;

export function migrateChildAuthorizations(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=29")) return;
    s.db.exec(`CREATE TABLE child_authorizations(
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      group_id TEXT NOT NULL REFERENCES sessions(id), requester_session_id TEXT NOT NULL REFERENCES sessions(id),
      request_key TEXT NOT NULL, spec_json TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')),
      authorization_code TEXT UNIQUE, max_calls INTEGER NOT NULL DEFAULT 0, used_calls INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT, child_session_id TEXT REFERENCES sessions(id), decision_reason TEXT,
      created_at TEXT NOT NULL, UNIQUE(requester_session_id,request_key));
      CREATE TABLE direct_child_creations(
        parent_session_id TEXT NOT NULL REFERENCES sessions(id), request_key TEXT NOT NULL,
        spec_json TEXT NOT NULL, child_session_id TEXT NOT NULL REFERENCES sessions(id),
        PRIMARY KEY(parent_session_id,request_key));
      INSERT INTO schema_migrations VALUES(29,datetime('now'));`);
    // New immutable policy/config revisions; preserve prior prompts and native sessions.
    const versions = new Map<string, number>();
    for (const policy of s.all(
      "SELECT * FROM system_ai_policies p WHERE version=(SELECT MAX(version) FROM system_ai_policies q WHERE q.id=p.id)",
    )) {
      const version = Number(policy.version) + 1;
      versions.set(String(policy.id), version);
      const tools = JSON.parse(String(policy.required_tools_json));
      tools.push({
        id: "system.child-authorization",
        name: "下级协作申请与授权通信",
        status: "available",
      });
      s.run(
        "INSERT INTO system_ai_policies VALUES(?,?,?,?,?)",
        String(policy.id),
        version,
        `${policy.instructions}\n\n${CHILD_AUTHORIZATION_POLICY}`,
        JSON.stringify(tools),
        String(policy.required_skills_json),
      );
    }
    for (const agent of s.all(
      "SELECT a.id,a.config_version,w.project_id,l.policy_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id JOIN agent_config_layers l ON l.agent_id=a.id AND l.version=a.config_version",
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
        versions.get(String(agent.policy_id))!,
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
        "agent.child_authorization_policy",
        String(agent.id),
        { version },
      );
    }
  });
}

function actor(s: Store, p: string, groupId: string, sessionId: string) {
  const root = coordinatorSession(s, p, groupId);
  const session = sessionInProject(s, p, sessionId);
  assert(session.status === "open", "会话已关闭");
  assert(
    groupCandidates(s, p, groupId).some((r) => r.id === sessionId),
    "申请者不属于当前总控群",
  );
  return { root, session };
}

/** Visible canonical group events carry prose only, never capability codes. */
function announce(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
  content: string,
) {
  const ss = sessionInProject(s, p, sessionId),
    messageId = id();
  s.run(
    "INSERT INTO messages VALUES(?,?,?,?,?,?,?)",
    messageId,
    sessionId,
    "agent",
    String(ss.agent_id),
    content,
    null,
    now(),
  );
  const a = requireRow(
    s.one("SELECT config_version FROM agents WHERE id=?", String(ss.agent_id)),
  );
  s.run(
    "INSERT INTO message_prompt_versions VALUES(?,?,?)",
    messageId,
    String(ss.agent_id),
    Number(a.config_version),
  );
  publishGroupMessage(s, p, groupId, messageId, []);
  return messageId;
}

export function requestChildAuthorization(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
  input: unknown,
) {
  const { session } = actor(s, p, groupId, sessionId);
  assert(sessionId !== groupId, "总控可以直接创建子 AI，无需向自己申请");
  const d = z
    .object({
      key: z.string().min(1).max(100),
      spec: specification,
      reason: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(input);
  assert(
    !d.spec.nodeId || d.spec.nodeId === session.node_id,
    "下级协作只能在申请者所在节点开展",
  );
  if (d.spec.childSessionId) {
    const child = sessionInProject(s, p, d.spec.childSessionId);
    assert(
      s.one(
        "SELECT 1 FROM ai_relations WHERE parent_id=? AND child_id=?",
        String(session.agent_id),
        String(child.agent_id),
      ),
      "只能申请自己的直接下级",
    );
  }
  return s.transaction(() => {
    const old = s.one(
      "SELECT * FROM child_authorizations WHERE requester_session_id=? AND request_key=?",
      sessionId,
      d.key,
    );
    const payload = JSON.stringify(d.spec);
    if (old) {
      assert(
        old.group_id === groupId &&
          old.spec_json === payload &&
          old.reason === d.reason,
        "同一申请标识的内容不能改变",
      );
      return { id: old.id, status: old.status };
    }
    const requestId = id();
    s.run(
      "INSERT INTO child_authorizations(id,project_id,group_id,requester_session_id,request_key,spec_json,reason,status,child_session_id,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)",
      requestId,
      p,
      groupId,
      sessionId,
      d.key,
      payload,
      d.reason,
      d.spec.childSessionId ?? null,
      now(),
    );
    announce(
      s,
      p,
      groupId,
      sessionId,
      `**申请协作授权**\n\n希望${d.spec.childSessionId ? "继续调用" : "创建"}「${d.spec.name}」协助：${d.spec.objective}\n\n申请理由：${d.reason}\n\n等待总控审核。`,
    );
    audit(s, p, "child.authorization_requested", requestId, {
      requesterSessionId: sessionId,
    });
    return {
      id: requestId,
      status: "pending",
      next: "结束本次汇报，等待总控批准后再继续",
    };
  });
}

export function childAuthorizations(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
): Row[] {
  actor(s, p, groupId, sessionId);
  return s
    .all(
      "SELECT * FROM child_authorizations WHERE project_id=? AND group_id=? AND (?=group_id OR requester_session_id=?) ORDER BY rowid",
      p,
      groupId,
      sessionId,
      sessionId,
    )
    .map((r) => {
      const { authorization_code, spec_json, ...rest } = r;
      return {
        ...rest,
        spec: JSON.parse(String(spec_json)),
        ...(r.requester_session_id === sessionId && r.status === "approved"
          ? { authorizationCode: authorization_code }
          : {}),
      };
    });
}

export function reviewChildAuthorization(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
  input: unknown,
) {
  assert(sessionId === groupId, "只有本群总控可审批协作授权");
  coordinatorSession(s, p, sessionId);
  const d = z
    .object({
      id: z.uuid(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().min(1).max(2000),
      maxCalls: z.number().int().min(1).max(30).default(8),
      validHours: z.number().int().min(1).max(72).default(24),
    })
    .strict()
    .parse(input);
  return s.transaction(() => {
    const r = requireRow(
      s.one(
        "SELECT * FROM child_authorizations WHERE id=? AND project_id=? AND group_id=?",
        d.id,
        p,
        groupId,
      ),
      "授权申请",
    );
    if (r.status !== "pending") {
      assert(
        r.status === d.decision && r.decision_reason === d.reason,
        "该申请已经处理",
      );
      return {
        id: r.id,
        status: r.status,
        requesterSessionId: r.requester_session_id,
      };
    }
    actor(s, p, groupId, String(r.requester_session_id));
    const spec = JSON.parse(String(r.spec_json));
    const code =
      d.decision === "approved" ? randomBytes(24).toString("base64url") : null;
    s.run(
      "UPDATE child_authorizations SET status=?,authorization_code=?,max_calls=?,expires_at=?,decision_reason=? WHERE id=?",
      d.decision,
      code,
      d.maxCalls,
      new Date(Date.now() + d.validHours * 3600000).toISOString(),
      d.reason,
      d.id,
    );
    announce(
      s,
      p,
      groupId,
      sessionId,
      `**${d.decision === "approved" ? "已批准协作授权" : "未批准协作授权"}**\n\n「${spec.name}」：${spec.objective}\n\n${d.reason}${code ? `\n\n允许协作 ${d.maxCalls} 次，${d.validHours} 小时内有效。` : ""}`,
    );
    audit(s, p, "child.authorization_reviewed", d.id, {
      decision: d.decision,
      reason: d.reason,
    });
    return {
      id: r.id,
      status: d.decision,
      requesterSessionId: r.requester_session_id,
      next: code
        ? "请通知申请者查询自己的授权并继续任务"
        : "请通知申请者按审核意见调整",
    };
  });
}

function validGrant(
  s: Store,
  p: string,
  sessionId: string,
  code?: string,
  groupId?: string,
) {
  assert(code, "需要总控批准的授权码");
  const r = requireRow(
    s.one(
      "SELECT * FROM child_authorizations WHERE authorization_code=? AND project_id=? AND requester_session_id=?",
      code,
      p,
      sessionId,
    ),
    "协作授权",
  );
  assert(!groupId || r.group_id === groupId, "授权不属于当前群");
  assert(
    r.status === "approved" && String(r.expires_at) > now(),
    "授权已失效、撤销或尚未批准",
  );
  assert(
    Number(r.used_calls) < Number(r.max_calls),
    "授权协作次数已用完，请重新申请",
  );
  return r;
}

export function authorizeChildMessage(
  s: Store,
  p: string,
  fromId: string,
  toId: string,
  code?: string,
  groupId?: string,
  consume = false,
) {
  const from = sessionInProject(s, p, fromId),
    to = sessionInProject(s, p, toId);
  if (from.node_type === "coordinator") {
    assert(
      groupCandidates(s, p, fromId).some(
        (r) => r.id === toId && toId !== fromId,
      ),
      "总控只能调用本群的下级 AI",
    );
    return;
  }
  assert(
    s.one(
      "SELECT 1 FROM ai_relations WHERE parent_id=? AND child_id=?",
      String(from.agent_id),
      String(to.agent_id),
    ),
    "只能向直接下级发送任务",
  );
  const grant = validGrant(s, p, fromId, code, groupId);
  assert(grant.child_session_id === toId, "授权码与目标子 AI 不匹配");
  if (consume)
    s.run(
      "UPDATE child_authorizations SET used_calls=used_calls+1 WHERE id=?",
      String(grant.id),
    );
}

export function createChildAgent(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
  input: unknown,
) {
  const { session } = actor(s, p, groupId, sessionId);
  const d = z
    .object({
      key: z.string().min(1).max(100),
      spec: specification.optional(),
      authorizationCode: z.string().optional(),
    })
    .strict()
    .parse(input);
  return s.transaction(() => {
    let grant: Row | undefined;
    let spec: z.infer<typeof specification>;
    if (sessionId === groupId) {
      spec = specification.parse(d.spec);
      assert(!spec.childSessionId, "恢复已有 AI 请直接调用它");
    } else {
      grant = validGrant(s, p, sessionId, d.authorizationCode, groupId);
      assert(!d.spec, "获授权后只传授权码，不能改写获批任务");
      spec = specification.parse(JSON.parse(String(grant.spec_json)));
    }
    if (grant?.child_session_id)
      return { sessionId: grant.child_session_id, reused: true };
    const payload = JSON.stringify(spec);
    const old = s.one(
      "SELECT * FROM direct_child_creations WHERE parent_session_id=? AND request_key=?",
      sessionId,
      d.key,
    );
    if (old) {
      assert(!grant && old.spec_json === payload, "创建标识已使用");
      return { sessionId: old.child_session_id, reused: true };
    }
    let nodeId =
      spec.nodeId ??
      (sessionId === groupId ? undefined : String(session.node_id));
    if (nodeId) {
      const node = nodeInProject(s, p, nodeId);
      assert(
        node.node_type !== "coordinator",
        "专业子 AI 不能挂到总控节点或继承总控权限",
      );
      assert(
        sessionId === groupId || nodeId === session.node_id,
        "不能越过授权节点创建 AI",
      );
    } else {
      const parentNode = nodeInProject(s, p, String(session.node_id));
      nodeId = String(
        createNode(s, p, {
          workflowId: parentNode.workflow_id,
          name: spec.name,
          objective: spec.objective,
        })!.id,
      );
    }
    const child = createAgent(s, p, {
      nodeId,
      name: spec.name,
      purpose: spec.objective,
      instructions:
        spec.instructions ||
        `## 身份\n你是${spec.name}。\n## 目标\n${spec.objective}\n## 交付\n向上级反馈实际结果、依据与问题，遵守总控审核和协作授权规则。`,
    });
    s.run(
      "INSERT INTO ai_relations VALUES(?,?)",
      String(child.id),
      String(session.agent_id),
    );
    const ss = createSession(s, p, {
      agentId: child.id,
      title: `${spec.name}讨论`,
    });
    if (grant)
      s.run(
        "UPDATE child_authorizations SET child_session_id=? WHERE id=?",
        String(ss.id),
        String(grant.id),
      );
    s.run(
      "INSERT INTO direct_child_creations VALUES(?,?,?,?)",
      sessionId,
      d.key,
      payload,
      String(ss.id),
    );
    announce(
      s,
      p,
      groupId,
      sessionId,
      `**已创建协作 AI**\n\n「${spec.name}」负责：${spec.objective}\n\n会话已保存，收到任务后开始协作。`,
    );
    audit(s, p, "child.created", String(child.id), {
      parentSessionId: sessionId,
      authorizationId: grant?.id ?? null,
    });
    return { sessionId: ss.id, agentId: child.id, nodeId, reused: false };
  });
}

export function revokeChildAuthorization(
  s: Store,
  p: string,
  groupId: string,
  sessionId: string,
  input: unknown,
) {
  assert(groupId === sessionId, "只有本群总控可撤销授权");
  coordinatorSession(s, p, sessionId);
  const d = z
    .object({ id: z.uuid(), reason: z.string().trim().min(1).max(2000) })
    .strict()
    .parse(input);
  return s.transaction(() => {
    const r = requireRow(
      s.one(
        "SELECT * FROM child_authorizations WHERE id=? AND project_id=? AND group_id=?",
        d.id,
        p,
        groupId,
      ),
    );
    if (r.status === "revoked") return { id: r.id, status: r.status };
    assert(r.status === "approved", "只能撤销已批准授权");
    s.run(
      "UPDATE child_authorizations SET status='revoked',decision_reason=? WHERE id=?",
      d.reason,
      d.id,
    );
    const spec = JSON.parse(String(r.spec_json));
    announce(
      s,
      p,
      groupId,
      sessionId,
      `**已撤销协作授权**\n\n「${spec.name}」停止接受该授权的新任务。\n\n原因：${d.reason}`,
    );
    if (r.child_session_id)
      setGroupMember(s, p, groupId, String(r.child_session_id), "paused", true);
    audit(s, p, "child.authorization_revoked", d.id, { reason: d.reason });
    return { id: r.id, status: "revoked" };
  });
}
