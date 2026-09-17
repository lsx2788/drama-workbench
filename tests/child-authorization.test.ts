import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { importStory } from "../src/server/story-service";
import { workspace } from "../src/server/read-service";
import { executeTool } from "../src/server/ai-tools";
import {
  childAuthorizations,
  createChildAgent,
  requestChildAuthorization,
  reviewChildAuthorization,
  revokeChildAuthorization,
} from "../src/server/child-authorization";
import {
  createSession,
  postHumanMessage,
} from "../src/server/collaboration-service";
import { publishGroupMessage } from "../src/server/group-service";
import { postAgentMessage } from "../src/server/writer-collaboration";

test("scoped grants gate creation and every child relay, with visible events, nesting and durable sessions", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "drama-child-auth-"));
  let s = new Store(dir);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(dir, { recursive: true, force: true });
  });
  const imported = importStory(s, {
    source: "text",
    text: "云澜御剑飞行",
    importKey: randomUUID(),
  });
  const p = String(imported.project.id),
    root = String(workspace(s, p).sessions[0].id);
  const human = postHumanMessage(s, p, root, {
    content: "请安排分镜协作",
  }).message!;
  publishGroupMessage(s, p, root, String(human.id), []);
  let runs = 0;
  const tool = async (
    session: string,
    profile: string,
    action: string,
    data: unknown,
  ) =>
    (
      await executeTool(
        s,
        p,
        session,
        profile,
        { action, data: JSON.stringify(data) },
        async () => {
          runs++;
          return { done: true };
        },
        { id: root, triggerId: String(human.id) },
      )
    ).result as Record<string, any>;
  const created = await tool(root, "coordinator", "create_child", {
    key: "storyboard",
    spec: { name: "分镜 AI", objective: "设计分镜并核对衔接" },
  });
  const parent = String(created.sessionId);
  assert.equal(
    workspace(s, p).sessions.find((r) => r.id === parent)!.node_type,
    "work",
  );
  assert.equal(
    (
      await tool(root, "coordinator", "create_child", {
        key: "storyboard",
        spec: { name: "分镜 AI", objective: "设计分镜并核对衔接" },
      })
    ).sessionId,
    parent,
  );
  await assert.rejects(
    tool(root, "coordinator", "create_child", {
      key: "bad",
      spec: {
        name: "伪总控",
        objective: "扩大权限",
        nodeId: workspace(s, p).nodes.find(
          (r) => r.node_type === "coordinator",
        )!.id,
      },
    }),
    /总控权限/,
  );
  await tool(root, "coordinator", "ask_child", {
    sessionId: parent,
    content: "请先检查故事场景",
  });
  await assert.rejects(
    tool(parent, "work", "create_child", {
      key: "forged",
      spec: { name: "下级", objective: "直接创建" },
    }),
    /授权码/,
  );
  const spec = { name: "连续性核对 AI", objective: "检查镜头人物与道具衔接" };
  const req = await tool(parent, "work", "request_child_authorization", {
    key: "continuity",
    spec,
    reason: "需要独立核对复杂场景",
  });
  assert.equal(req.status, "pending");
  assert.equal(
    (
      await tool(parent, "work", "request_child_authorization", {
        key: "continuity",
        spec,
        reason: "需要独立核对复杂场景",
      })
    ).id,
    req.id,
  );
  await assert.rejects(
    tool(parent, "work", "review_child_authorization", {
      id: req.id,
      decision: "approved",
      reason: "自批",
    }),
    /权限/,
  );
  await tool(root, "coordinator", "review_child_authorization", {
    id: req.id,
    decision: "approved",
    reason: "同意独立核对",
    maxCalls: 2,
  });
  const grant = childAuthorizations(s, p, root, parent).find(
    (r) => r.id === req.id,
  )!;
  const code = String(grant.authorizationCode);
  assert.ok(code.length > 20);
  assert.ok(
    !JSON.stringify(childAuthorizations(s, p, root, root)).includes(code),
  );
  const child = (
    await tool(parent, "work", "create_child", {
      key: "continuity-child",
      authorizationCode: code,
    })
  ).sessionId as string;
  assert.equal(
    (
      await tool(parent, "work", "create_child", {
        key: "repeat",
        authorizationCode: code,
      })
    ).sessionId,
    child,
  );
  await assert.rejects(
    tool(parent, "work", "create_child", {
      key: "change",
      authorizationCode: code,
      spec: { ...spec, objective: "更改获批范围" },
    }),
    /不能改写/,
  );
  const before = s.one("SELECT count(*) n FROM messages")!.n;
  await assert.rejects(
    tool(parent, "work", "ask_child", {
      sessionId: child,
      content: "无授权的消息",
    }),
    /授权码/,
  );
  assert.equal(s.one("SELECT count(*) n FROM messages")!.n, before);
  assert.throws(
    () =>
      postAgentMessage(s, p, child, {
        fromSessionId: parent,
        content: "绕过工具",
      }),
    /授权码/,
  );
  await tool(parent, "work", "ask_child", {
    sessionId: child,
    content: "请核对前三镜",
    authorizationCode: code,
  });
  postAgentMessage(s, p, child, {
    fromSessionId: parent,
    content: "补充核对剑的持握",
    authorizationCode: code,
  });
  await assert.rejects(
    tool(parent, "work", "ask_child", {
      sessionId: child,
      content: "超出次数",
      authorizationCode: code,
    }),
    /次数/,
  );
  assert.equal(runs, 2);
  await tool(root, "coordinator", "ask_child", {
    sessionId: child,
    content: "总控直接询问下级的进展",
  });
  assert.equal(
    runs,
    3,
    "coordinator may resume a descendant after reviewing its request",
  );
  const nested = requestChildAuthorization(s, p, root, child, {
    key: "nested",
    spec: { name: "服装核对 AI", objective: "核对衣服连续性" },
    reason: "需要检查衣服变化",
  });
  assert.equal(nested.status, "pending");
  assert.throws(
    () =>
      createChildAgent(s, p, root, child, {
        key: "stolen",
        authorizationCode: code,
      }),
    /授权/,
  );
  reviewChildAuthorization(s, p, root, root, {
    id: nested.id,
    decision: "rejected",
    reason: "当前不需要再拆分",
  });
  assert.equal(childAuthorizations(s, p, root, child)[0].status, "rejected");
  const renewal = requestChildAuthorization(s, p, root, parent, {
    key: "renew",
    spec: { ...spec, childSessionId: child },
    reason: "继续复核",
  });
  reviewChildAuthorization(s, p, root, root, {
    id: renewal.id,
    decision: "approved",
    reason: "同意继续",
    maxCalls: 3,
  });
  const renewed = String(
    childAuthorizations(s, p, root, parent).find((r) => r.id === renewal.id)!
      .authorizationCode,
  );
  const sibling = await tool(root, "coordinator", "create_child", {
    key: "sibling",
    spec: { name: "美术 AI", objective: "设计场景" },
  });
  assert.throws(
    () =>
      createChildAgent(s, p, root, String(sibling.sessionId), {
        key: "steal",
        authorizationCode: renewed,
      }),
    /授权/,
  );
  const rootAgent = String(
    workspace(s, p).sessions.find((r) => r.id === root)!.agent_id,
  );
  const otherGroup = String(
    createSession(s, p, { agentId: rootAgent, title: "另一总控群" }).id,
  );
  assert.throws(
    () =>
      createChildAgent(s, p, otherGroup, parent, {
        key: "cross-group",
        authorizationCode: renewed,
      }),
    /当前群/,
  );
  const otherProject = importStory(s, {
    source: "text",
    text: "另一项目",
    importKey: randomUUID(),
  });
  assert.throws(() =>
    createChildAgent(s, String(otherProject.project.id), root, parent, {
      key: "cross-project",
      authorizationCode: renewed,
    }),
  );
  s.run(
    "UPDATE child_authorizations SET expires_at='2000-01-01' WHERE id=?",
    String(renewal.id),
  );
  assert.throws(
    () =>
      postAgentMessage(s, p, child, {
        fromSessionId: parent,
        content: "过期消息",
        authorizationCode: renewed,
      }),
    /失效/,
  );
  s.run(
    "UPDATE child_authorizations SET expires_at='2999-01-01' WHERE id=?",
    String(renewal.id),
  );
  revokeChildAuthorization(s, p, root, root, {
    id: renewal.id,
    reason: "当前环节结束",
  });
  await assert.rejects(
    tool(parent, "work", "ask_child", {
      sessionId: child,
      content: "撤销后",
      authorizationCode: renewed,
    }),
    /撤销/,
  );
  const messages = workspace(s, p).messages.filter(
    (m) => (m.group as any)?.group_id === root,
  );
  for (const phrase of [
    "申请协作授权",
    "已批准协作授权",
    "未批准协作授权",
    "已创建协作 AI",
    "已撤销协作授权",
  ])
    assert.ok(
      messages.some((m) => String(m.content).includes(phrase)),
      phrase,
    );
  assert.ok(!JSON.stringify(workspace(s, p)).includes(code));
  assert.ok(!JSON.stringify(workspace(s, p)).includes(renewed));
  assert.ok(
    messages
      .filter((m) => String(m.content).includes("申请协作授权"))
      .every((m) => m.sender_id !== rootAgent),
  );
  s.close();
  s = new Store(dir);
  assert.equal(
    s.one(
      "SELECT status FROM child_authorizations WHERE id=?",
      String(renewal.id),
    )!.status,
    "revoked",
  );
  assert.ok(workspace(s, p).sessions.some((r) => r.id === child));
  assert.deepEqual(s.all("PRAGMA foreign_key_check"), []);
});
