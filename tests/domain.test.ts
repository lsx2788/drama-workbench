import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store, type Row } from "../src/server/db";
import {
  createProject,
  createWorkflow,
  createNode,
  activateWorkflow,
  updateNodeState,
  overview,
  createDocument,
} from "../src/server/project-service";
import {
  createAsset,
  searchAssets,
  createVersion,
  addFile,
  reviewVersion,
  assetDetail,
  lineage,
} from "../src/server/asset-service";
import {
  createAgent,
  createSession,
  postHumanMessage,
  createHighlight,
  confirmHighlight,
  registerSkill,
  bindSkill,
} from "../src/server/collaboration-service";
import {
  createItem,
  setItemState,
  contextForItem,
  prepareRun,
} from "../src/server/work-service";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-domain-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProject(s, { name: "测试项目" }).id),
    w = String(createWorkflow(s, p, { name: "制作草案" })!.id);
  const n = String(createNode(s, p, { workflowId: w, name: "人物设计" })!.id),
    c = String(
      createNode(s, p, {
        workflowId: w,
        name: "总控",
        nodeType: "coordinator",
      })!.id,
    );
  return { s, p, w, n, c, root };
}
function finalized(
  s: Store,
  p: string,
  code: string,
  attrs: Record<string, unknown> = {},
) {
  const asset = createAsset(s, p, {
      code,
      name: code,
      kind: "character",
      attributes: attrs,
    }),
    version = createVersion(s, p, String(asset.id), {});
  addFile(s, p, String(version.id), {
    name: "说明.txt",
    type: "text/plain",
    bytes: Buffer.from("真实保存的资产文件"),
  });
  reviewVersion(s, p, String(version.id), {
    decision: "approved",
    scope: "形象与服装",
  });
  return { asset, version };
}
test("overview is derived and the project table has no duplicated stage fields", (t) => {
  const { s, p, w, n } = fixture(t);
  activateWorkflow(s, p, w);
  updateNodeState(s, p, n, "active");
  assert.equal(overview(s, p).stages.find((r) => r.id === n)?.status, "active");
  assert.deepEqual(
    s.all("PRAGMA table_info(projects)").map((r) => r.name),
    ["id", "name", "description", "goal", "created_at"],
  );
});
test("age variants coexist, exact attribute filters do not guess or fall back", (t) => {
  const { s, p } = fixture(t);
  finalized(s, p, "001", { age: 20, costume: "青衣" });
  finalized(s, p, "002", { age: 40, costume: "掌门服" });
  assert.equal(searchAssets(s, p, { attributes: { age: 40 } })[0]?.code, "002");
  assert.equal(searchAssets(s, p, { attributes: { age: 30 } }).length, 0);
  assert.throws(() => searchAssets(s, p, { randomFilter: "x" }));
  assert.throws(() =>
    createAsset(s, p, { code: "001", name: "重复", kind: "character" }),
  );
});
test("publishing requires a real unchanged file and freezes version contents", (t) => {
  const { s, p } = fixture(t),
    a = createAsset(s, p, { code: "001", name: "男主", kind: "character" }),
    v = createVersion(s, p, String(a.id), {});
  assert.throws(
    () =>
      reviewVersion(s, p, String(v.id), {
        decision: "approved",
        scope: "面容",
      }),
    /实际文件/,
  );
  const f = addFile(s, p, String(v.id), {
    name: "face.txt",
    type: "text/plain",
    bytes: Buffer.from("face"),
  });
  reviewVersion(s, p, String(v.id), { decision: "approved", scope: "仅面容" });
  assert.throws(
    () =>
      addFile(s, p, String(v.id), {
        name: "other",
        type: "text/plain",
        bytes: Buffer.from("x"),
      }),
    /候选/,
  );
  assert.throws(
    () =>
      reviewVersion(s, p, String(v.id), {
        decision: "rejected",
        scope: "改口",
      }),
    /不可重写/,
  );
  assert.equal(String(f.version_id), v.id);
});
test("missing files cannot be published and review failure is atomic", (t) => {
  const { s, p, root } = fixture(t),
    a = createAsset(s, p, { code: "001", name: "男主", kind: "character" }),
    v = createVersion(s, p, String(a.id), {});
  const f = addFile(s, p, String(v.id), {
    name: "face.txt",
    type: "text/plain",
    bytes: Buffer.from("face"),
  });
  unlinkSync(path.join(root, "files", String(f.file_key)));
  assert.throws(
    () =>
      reviewVersion(s, p, String(v.id), {
        decision: "approved",
        scope: "面容",
      }),
    /缺失/,
  );
  assert.equal(s.all("SELECT * FROM reviews").length, 0);
  assert.equal(
    s.one("SELECT status FROM asset_versions WHERE id=?", String(v.id))?.status,
    "candidate",
  );
});
test("composites pin source versions and later source revisions preserve lineage", (t) => {
  const { s, p } = fixture(t),
    base = finalized(s, p, "001"),
    sword = finalized(s, p, "008");
  const combo = createAsset(s, p, {
    code: "020",
    name: "持剑",
    kind: "composite",
  });
  const v = createVersion(s, p, String(combo.id), {
    sources: [base.version.id, sword.version.id],
  });
  addFile(s, p, String(v.id), {
    name: "combo.txt",
    type: "text/plain",
    bytes: Buffer.from("combo"),
  });
  reviewVersion(s, p, String(v.id), {
    decision: "approved",
    scope: "持握组合",
  });
  createVersion(s, p, String(base.asset.id), { notes: "年龄感修订" });
  assert.equal(lineage(s, p, String(base.version.id)).descendants[0]?.id, v.id);
  assert.equal(lineage(s, p, String(v.id)).ancestors.length, 2);
  assert.equal(
    (assetDetail(s, p, String(base.asset.id)).versions[1] as Row).version,
    1,
  );
});
test("cross-project references and candidate sources are rejected", (t) => {
  const { s, p } = fixture(t),
    foreign = String(createProject(s, { name: "另一个项目" }).id),
    base = finalized(s, foreign, "001");
  const a = createAsset(s, p, { code: "020", name: "组合", kind: "composite" });
  assert.throws(
    () => createVersion(s, p, String(a.id), { sources: [base.version.id] }),
    /不存在/,
  );
  const pending = createVersion(s, p, String(a.id), {});
  assert.throws(
    () => createVersion(s, p, String(a.id), { sources: [pending.id] }),
    /已定稿/,
  );
});
test("humans can write only to coordinator sessions and messages persist across reopen", (t) => {
  const { s, p, n, c, root } = fixture(t);
  const child = createAgent(s, p, {
      nodeId: n,
      name: "人物 AI",
      purpose: "设计",
    }),
    boss = createAgent(s, p, { nodeId: c, name: "总控", purpose: "协调" });
  const cs = createSession(s, p, {
      agentId: child.id,
      title: "形象设计",
      externalSessionId: "external-child-123",
    }),
    bs = createSession(s, p, { agentId: boss.id, title: "主对话" });
  assert.throws(
    () => postHumanMessage(s, p, String(cs.id), { content: "越过总控" }),
    /总控/,
  );
  const sent = postHumanMessage(s, p, String(bs.id), { content: "保持君子气" });
  const reopened = new Store(root);
  assert.equal(
    reopened.one(
      "SELECT content FROM messages WHERE id=?",
      String(sent.message?.id),
    )?.content,
    "保持君子气",
  );
  assert.equal(
    reopened.one(
      "SELECT external_session_id FROM sessions WHERE id=?",
      String(cs.id),
    )?.external_session_id,
    "external-child-123",
  );
  reopened.close();
});
test("session continuation is identity-bound and quote stays project-scoped", (t) => {
  const { s, p, c, n } = fixture(t),
    a = createAgent(s, p, { nodeId: c, name: "总控", purpose: "协调" }),
    b = createAgent(s, p, { nodeId: n, name: "画师", purpose: "设计" });
  const ss = createSession(s, p, { agentId: a.id, title: "主对话" });
  assert.throws(
    () =>
      createSession(s, p, {
        agentId: b.id,
        title: "错误接续",
        predecessorId: ss.id,
      }),
    /同一 AI/,
  );
  const next = createSession(s, p, {
    agentId: a.id,
    title: "接续讨论",
    predecessorId: ss.id,
  });
  assert.equal(next.predecessor_id, ss.id);
  assert.throws(
    () =>
      postHumanMessage(s, p, String(ss.id), {
        content: "引用缺失",
        quoteId: "11111111-1111-4111-8111-111111111111",
      }),
    /不存在/,
  );
});
test("discussion proposals are excluded from context; supersession preserves history", (t) => {
  const { s, p, n } = fixture(t),
    item = createItem(s, p, { nodeId: n, title: "人物图" });
  const h = createHighlight(s, p, {
    nodeId: n,
    kind: "decision",
    content: "青衣",
    rationale: "与前期身份相符",
  });
  assert.equal(contextForItem(s, p, String(item.id)).highlights.length, 0);
  confirmHighlight(s, p, String(h?.id));
  assert.equal(contextForItem(s, p, String(item.id)).highlights.length, 1);
  assert.throws(
    () =>
      createHighlight(s, p, {
        nodeId: n,
        kind: "decision",
        content: "白衣",
        supersedesId: h?.id,
      }),
    /明确确认/,
  );
  createHighlight(s, p, {
    nodeId: n,
    kind: "decision",
    content: "白衣",
    status: "confirmed",
    supersedesId: h?.id,
  });
  assert.equal(
    s.one("SELECT status FROM highlights WHERE id=?", String(h?.id))?.status,
    "superseded",
  );
  assert.equal(
    contextForItem(s, p, String(item.id)).highlights[0]?.content,
    "白衣",
  );
});
test("workflow and item dependency gates prevent premature progress", (t) => {
  const { s, p, w, n } = fixture(t),
    next = createNode(s, p, { workflowId: w, name: "分镜", dependencies: [n] });
  activateWorkflow(s, p, w);
  assert.throws(
    () => updateNodeState(s, p, String(next?.id), "active"),
    /前置/,
  );
  const first = createItem(s, p, { nodeId: n, title: "准备素材" }),
    second = createItem(s, p, {
      nodeId: n,
      title: "制作",
      dependencies: [first.id],
    });
  assert.throws(
    () => setItemState(s, p, String(second.id), { status: "ready" }),
    /前置/,
  );
  setItemState(s, p, String(first.id), {
    status: "completed",
    reason: "素材已审核",
  });
  setItemState(s, p, String(second.id), { status: "ready" });
  assert.throws(
    () => setItemState(s, p, String(first.id), { status: "planned" }),
    /下游/,
  );
  assert.throws(() => updateNodeState(s, p, n, "completed"), /未完成事项/);
});
test("execution requests are idempotent and never fabricate a running provider", (t) => {
  const { s, p, n, w } = fixture(t),
    a = createAgent(s, p, { nodeId: n, name: "执行 AI", purpose: "生图" }),
    ss = createSession(s, p, { agentId: a.id, title: "执行" }),
    item = createItem(s, p, { nodeId: n, title: "生图", agentId: a.id });
  activateWorkflow(s, p, w);
  setItemState(s, p, String(item.id), { status: "ready" });
  const input = {
    itemId: item.id,
    sessionId: ss.id,
    idempotencyKey: "execution-request-1",
  };
  const one = prepareRun(s, p, input),
    two = prepareRun(s, p, input);
  assert.equal(one?.id, two?.id);
  assert.equal(one?.status, "blocked");
  assert.equal(one?.provider_run_id, null);
  assert.equal(s.all("SELECT * FROM runs").length, 1);
  assert.match(String(one?.config_snapshot), /执行 AI/);
});
test("items cannot bypass draft workflows or unfinished node dependencies", (t) => {
  const { s, p, n, w } = fixture(t);
  const later = createNode(s, p, {
    workflowId: w,
    name: "后续节点",
    dependencies: [n],
  });
  const item = createItem(s, p, { nodeId: later!.id, title: "不能抢跑" });
  assert.throws(
    () => setItemState(s, p, String(item.id), { status: "ready" }),
    /未发布/,
  );
  activateWorkflow(s, p, w);
  assert.throws(
    () => setItemState(s, p, String(item.id), { status: "review" }),
    /前置节点/,
  );
  updateNodeState(s, p, n, "completed");
  setItemState(s, p, String(item.id), { status: "ready" });
  const replacement = createWorkflow(s, p, { name: "新版" });
  createNode(s, p, { workflowId: replacement!.id, name: "新节点" });
  assert.throws(
    () => activateWorkflow(s, p, String(replacement!.id)),
    /未完成事项/,
  );
});
test("skills must match explicitly allowed capabilities", (t) => {
  const { s, p, n } = fixture(t),
    a = createAgent(s, p, {
      nodeId: n,
      name: "分镜 AI",
      purpose: "分镜",
      tools: ["text-analysis"],
    });
  registerSkill(s, {
    id: "image-skill-v1",
    name: "图片生成",
    version: "1",
    capability: "image-generation",
  });
  assert.throws(
    () => bindSkill(s, p, String(a.id), "image-skill-v1"),
    /未获准/,
  );
  registerSkill(s, {
    id: "analysis-v1",
    name: "分析",
    version: "1",
    capability: "text-analysis",
  });
  assert.equal(bindSkill(s, p, String(a.id), "analysis-v1").length, 1);
});
test("document revisions preserve original content and reject stale updates", (t) => {
  const { s, p } = fixture(t),
    doc = createDocument(s, p, {
      title: "大纲",
      kind: "outline",
      content: "初版",
    })!;
  const next = createDocument(s, p, {
    title: "大纲",
    kind: "outline",
    content: "二版",
    supersedesId: doc.id,
  })!;
  assert.equal(next.revision, 2);
  assert.equal(
    s.one("SELECT content FROM documents WHERE id=?", String(doc.id))?.content,
    "初版",
  );
  assert.throws(
    () =>
      createDocument(s, p, {
        title: "大纲",
        kind: "outline",
        content: "覆盖",
        supersedesId: doc.id,
      }),
    /刷新/,
  );
});
