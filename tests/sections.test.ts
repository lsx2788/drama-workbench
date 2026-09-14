import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/db";
import {
  createProject,
  createWorkflow,
  createNode,
  activateWorkflow,
  updateNodeState,
} from "../src/server/project-service";
import { createSection, appendUnit } from "../src/server/section-service";
import { setItemState } from "../src/server/work-service";
import { workspace } from "../src/server/read-service";
import { layoutWorkflow } from "../src/client/workflow-layout";

test("units extend independently, roll back partial failures and gate the final delivery", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-sections-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProject(s, { name: "分集故事" }).id),
    workflowId = String(createWorkflow(s, p, { name: "总分总" })!.id);
  const prep = createSection(s, p, {
    workflowId,
    name: "全剧设定",
    phase: "preparation",
  });
  const delivery = createSection(s, p, {
    workflowId,
    name: "全剧交付",
    phase: "delivery",
  });
  const before = createNode(s, p, {
    workflowId,
    sectionId: prep.id,
    name: "大纲",
  })!;
  const after = createNode(s, p, {
    workflowId,
    sectionId: delivery.id,
    name: "归档",
    dependencies: [before.id],
  })!;
  activateWorkflow(s, p, workflowId);
  const steps = [
    {
      key: "script",
      name: "剧本",
      ai: { name: "编剧 AI", purpose: "分集剧本" },
    },
    { key: "review", name: "本集审核", dependencies: ["script"] },
  ];
  const first = appendUnit(s, p, {
    workflowId,
    name: "第一集",
    kind: "episode",
    steps,
  });
  const second = appendUnit(s, p, {
    workflowId,
    name: "第二章",
    kind: "chapter",
    steps,
  });
  assert.notEqual(first.section.id, second.section.id);
  const w = workspace(s, p);
  assert.equal(w.sessions.length, 2);
  assert.notEqual(w.sessions[0].agent_id, w.sessions[1].agent_id);
  for (const unit of [first, second]) {
    assert.ok(
      w.dependencies.some(
        (d) => d.node_id === unit.nodes[0] && d.depends_on === before.id,
      ),
    );
    assert.ok(
      w.dependencies.some(
        (d) => d.node_id === after.id && d.depends_on === unit.nodes[1],
      ),
    );
  }
  assert.throws(
    () => updateNodeState(s, p, String(after.id), "active"),
    /前置/,
  );
  const invalid = [
    { key: "valid", name: "已创建步骤" },
    { key: "invalid", name: "非法步骤", dependencies: ["missing"] },
  ];
  assert.throws(
    () =>
      appendUnit(s, p, {
        workflowId,
        name: "失败集",
        kind: "episode",
        steps: invalid,
      }),
    /前置步骤/,
  );
  assert.equal(workspace(s, p).nodes.length, w.nodes.length);
  assert.equal(workspace(s, p).sections.length, w.sections.length);
  assert.equal(workspace(s, p).items.length, w.items.length);
  assert.throws(
    () =>
      appendUnit(s, p, { workflowId, name: "第一集", kind: "episode", steps }),
    /同名/,
  );
  const foreign = String(createProject(s, { name: "另一项目" }).id);
  assert.throws(
    () =>
      appendUnit(s, foreign, {
        workflowId,
        name: "第三集",
        kind: "episode",
        steps,
      }),
    /不存在/,
  );
  const graph = layoutWorkflow(
    w.nodes.map((n) => ({ id: String(n.id) })),
    w.dependencies.map((e) => ({
      from: String(e.depends_on),
      to: String(e.node_id),
    })),
  );
  assert.equal(graph.hasCycle, false);
  for (const item of w.items)
    setItemState(s, p, String(item.id), {
      status: "cancelled",
      reason: "结束测试事项",
    });
  updateNodeState(s, p, String(before.id), "completed");
  for (const nodeId of [...first.nodes, ...second.nodes])
    updateNodeState(s, p, nodeId, "completed");
  updateNodeState(s, p, String(after.id), "active");
  assert.throws(
    () =>
      appendUnit(s, p, { workflowId, name: "第三集", kind: "episode", steps }),
    /汇总已开始/,
  );
});
