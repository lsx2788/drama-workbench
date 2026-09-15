import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import { createNode, updateNodeState } from "../src/server/project-service";
import { appendUnit, createSection } from "../src/server/section-service";
import { createItem, setItemState } from "../src/server/work-service";
import { postHumanMessage } from "../src/server/collaboration-service";
import { workspace } from "../src/server/read-service";

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-progressive-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProjectWithCoordinator(s, { name: "从讨论开始" }).id);
  const workflowId = String(workspace(s, p).overview.workflow!.id);
  return { s, p, workflowId };
}

test("start with only a coordinator, append active work and define archive last without losing discussions", (t) => {
  const { s, p, workflowId } = setup(t);
  const start = workspace(s, p);
  assert.equal(start.nodes.length, 1);
  assert.equal(start.nodes[0].node_type, "coordinator");
  assert.equal(start.sections.length, 0);
  assert.equal(start.seasons.length, 0);
  assert.equal(start.sessions.length, 1);
  assert.equal(start.messages.length, 0);
  assert.equal(start.agents[0].provider, "unconfigured");
  const message = postHumanMessage(s, p, String(start.sessions[0].id), {
    content: "先讨论第一集，后面的流程稍后确定。",
  });
  const story = createNode(s, p, { workflowId, name: "故事拆解" })!;
  updateNodeState(s, p, String(story.id), "completed");
  const unit = appendUnit(s, p, {
    workflowId,
    name: "第一集",
    kind: "episode",
  });
  assert.deepEqual(unit.nodes, []);
  const script = createNode(s, p, {
    workflowId,
    sectionId: unit.section.id,
    name: "分集剧本",
    dependencies: [story.id],
  })!;
  updateNodeState(s, p, String(script.id), "completed");
  const delivery = createSection(s, p, {
    workflowId,
    name: "汇总交付",
    phase: "delivery",
  });
  const archive = createNode(s, p, {
    workflowId,
    sectionId: delivery.id,
    name: "全剧归档",
  })!;
  const before = workspace(s, p);
  assert.ok(
    before.dependencies.some(
      (e) => e.node_id === archive.id && e.depends_on === script.id,
    ),
  );
  const review = createNode(s, p, {
    workflowId,
    sectionId: unit.section.id,
    name: "成片审核",
    dependencies: [script.id],
  })!;
  const after = workspace(s, p);
  assert.equal(
    after.nodes.find((n) => n.id === script.id)?.status,
    "completed",
  );
  assert.deepEqual(after.sessions, start.sessions);
  assert.equal(after.messages[0].id, message.message!.id);
  assert.deepEqual(
    after.dependencies.filter((e) => e.node_id === script.id),
    before.dependencies.filter((e) => e.node_id === script.id),
  );
  assert.ok(
    after.dependencies.some(
      (e) => e.node_id === archive.id && e.depends_on === review.id,
    ),
  );
  assert.throws(
    () => updateNodeState(s, p, String(archive.id), "active"),
    /前置/,
  );
  updateNodeState(s, p, String(review.id), "completed");
  updateNodeState(s, p, String(archive.id), "active");
  assert.throws(
    () => createNode(s, p, { workflowId, name: "来不及直接插入的步骤" }),
    /汇总已开始/,
  );
  assert.throws(
    () => appendUnit(s, p, { workflowId, name: "第二集", kind: "episode" }),
    /汇总已开始/,
  );
});

test("units need neither preparation nor delivery and batch failures roll back every partial record", (t) => {
  const { s, p, workflowId } = setup(t);
  const first = appendUnit(s, p, {
    workflowId,
    name: "第一集",
    kind: "episode",
    steps: [
      { key: "story", name: "剧本", ai: { name: "编剧", purpose: "编写本集" } },
    ],
  });
  assert.equal(first.nodes.length, 1);
  assert.equal(workspace(s, p).dependencies.length, 0);
  const looseStep = createNode(s, p, {
    workflowId,
    name: "尚未分组的共用设定",
  })!;
  const next = appendUnit(s, p, {
    workflowId,
    name: "第二集",
    kind: "episode",
    dependencies: [looseStep.id],
    steps: [{ key: "script", name: "本集剧本" }],
  });
  assert.ok(
    workspace(s, p).dependencies.some(
      (e) => e.node_id === next.nodes[0] && e.depends_on === looseStep.id,
    ),
  );
  assert.throws(
    () =>
      appendUnit(s, p, {
        workflowId,
        name: "不能丢弃依赖",
        kind: "episode",
        dependencies: [looseStep.id],
      }),
    /空分集/,
  );
  const before = workspace(s, p);
  assert.throws(
    () =>
      appendUnit(s, p, {
        workflowId,
        name: "未完成的扩展",
        kind: "episode",
        steps: [
          {
            key: "draft",
            name: "草稿",
            ai: { name: "编剧", purpose: "编写草稿" },
          },
          { key: "bad", name: "无效前置", dependencies: ["missing"] },
        ],
      }),
    /前置步骤/,
  );
  const after = workspace(s, p);
  for (const key of [
    "nodes",
    "sections",
    "agents",
    "sessions",
    "items",
    "dependencies",
    "audit",
  ] as const)
    assert.deepEqual(after[key], before[key]);
});

test("empty units block archive node and item progression; active archive items prevent production expansion", (t) => {
  const { s, p, workflowId } = setup(t);
  const delivery = createSection(s, p, {
    workflowId,
    name: "交付",
    phase: "delivery",
  });
  const archive = createNode(s, p, {
    workflowId,
    sectionId: delivery.id,
    name: "归档",
  })!;
  const item = createItem(s, p, { nodeId: archive.id, title: "整理发布信息" });
  const unit = createSection(s, p, {
    workflowId,
    name: "稍后细化的第一集",
    phase: "unit",
    kind: "episode",
  });
  for (const status of ["active", "review", "completed"])
    assert.throws(
      () => updateNodeState(s, p, String(archive.id), status),
      /尚未定义/,
    );
  assert.throws(
    () => setItemState(s, p, String(item.id), { status: "ready" }),
    /尚未定义/,
  );
  const work = createNode(s, p, {
    workflowId,
    sectionId: unit.id,
    name: "本集制作",
  })!;
  updateNodeState(s, p, String(work.id), "completed");
  setItemState(s, p, String(item.id), { status: "ready" });
  const before = workspace(s, p);
  assert.throws(
    () => createNode(s, p, { workflowId, name: "新增共用步骤" }),
    /汇总事项已开始/,
  );
  assert.throws(
    () =>
      createSection(s, p, {
        workflowId,
        name: "第二集",
        phase: "unit",
        kind: "episode",
      }),
    /汇总事项已开始/,
  );
  assert.throws(
    () => appendUnit(s, p, { workflowId, name: "第二集", kind: "episode" }),
    /汇总事项已开始/,
  );
  assert.deepEqual(workspace(s, p), before);
});

test("new gates cannot introduce cycles or bypass workflow ownership and archival", (t) => {
  const { s, p, workflowId } = setup(t);
  const delivery = createSection(s, p, {
    workflowId,
    name: "交付",
    phase: "delivery",
  });
  const archive = createNode(s, p, {
    workflowId,
    sectionId: delivery.id,
    name: "归档",
  })!;
  const before = workspace(s, p);
  assert.throws(
    () =>
      createNode(s, p, {
        workflowId,
        name: "循环步骤",
        dependencies: [archive.id],
      }),
    /循环/,
  );
  assert.deepEqual(workspace(s, p), before);
  const foreign = String(
    createProjectWithCoordinator(s, { name: "其他项目" }).id,
  );
  const foreignW = String(workspace(s, foreign).overview.workflow!.id);
  assert.throws(
    () => createNode(s, p, { workflowId: foreignW, name: "越界" }),
    /不存在/,
  );
  assert.throws(
    () =>
      createNode(s, foreign, {
        workflowId: foreignW,
        sectionId: delivery.id,
        name: "越界分组",
      }),
    /同一流程/,
  );
  s.run("UPDATE workflows SET status='archived' WHERE id=?", workflowId);
  assert.throws(
    () => createNode(s, p, { workflowId, name: "不能更改已归档流程" }),
    /归档流程/,
  );
  assert.throws(
    () =>
      createSection(s, p, { workflowId, name: "前期", phase: "preparation" }),
    /归档流程/,
  );
});
