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
} from "../src/server/project-service";
import { appendUnit, createSection } from "../src/server/section-service";
import { createSeason } from "../src/server/season-service";
import { workspace } from "../src/server/read-service";
import { productionMap } from "../src/client/production-map";
import { layoutWorkflow } from "../src/client/workflow-layout";

test("optional seasons preserve unit identities, enforce scope and project one navigable overview", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-seasons-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProject(s, { name: "季与集" }).id),
    workflowId = String(createWorkflow(s, p, { name: "制作" })!.id);
  const prep = createSection(s, p, {
    workflowId,
    name: "共用前期",
    phase: "preparation",
  });
  const delivery = createSection(s, p, {
    workflowId,
    name: "交付",
    phase: "delivery",
  });
  const coordinator = createNode(s, p, {
    workflowId,
    sectionId: prep.id,
    name: "总控协调",
    nodeType: "coordinator",
  })!;
  const before = createNode(s, p, {
    workflowId,
    sectionId: prep.id,
    name: "故事拆解",
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
      name: "本集剧本",
      ai: { name: "编剧", purpose: "写剧本" },
    },
    { key: "review", name: "本集审核", dependencies: ["script"] },
  ];
  const first = appendUnit(s, p, {
    workflowId,
    name: "第一集",
    kind: "episode",
    steps,
  });
  const snapshot = workspace(s, p);
  const without = productionMap(snapshot, workflowId);
  const hasEdge = (
    map: ReturnType<typeof productionMap>,
    from: unknown,
    to: unknown,
  ) => map.dependencies.some((e) => e.depends_on === from && e.node_id === to);
  assert.ok(hasEdge(without, coordinator.id, before.id));
  assert.ok(hasEdge(without, before.id, `unit:${first.section.id}`));
  assert.ok(hasEdge(without, `unit:${first.section.id}`, after.id));
  assert.ok(!without.nodes.some((n) => n.graph_kind === "season"));
  assert.ok(!without.nodes.some((n) => first.nodes.includes(String(n.id))));

  const season = createSeason(s, p, {
    workflowId,
    name: "第一季",
    description: "第一季的故事",
    unitIds: [first.section.id],
  });
  const grouped = workspace(s, p);
  assert.deepEqual(grouped.nodes, snapshot.nodes);
  assert.deepEqual(grouped.sessions, snapshot.sessions);
  assert.deepEqual(grouped.dependencies, snapshot.dependencies);
  const overview = productionMap(grouped, workflowId);
  assert.ok(hasEdge(overview, before.id, `season:${season.id}`));
  assert.ok(
    hasEdge(overview, `season:${season.id}`, `unit:${first.section.id}`),
  );
  assert.ok(hasEdge(overview, `unit:${first.section.id}`, after.id));
  assert.deepEqual(overview.targets.get(`unit:${first.section.id}`), {
    kind: "unit",
    id: first.section.id,
  });
  assert.deepEqual(overview.targets.get(String(coordinator.id)), {
    kind: "node",
    id: coordinator.id,
  });
  assert.throws(
    () =>
      createSeason(s, p, {
        workflowId,
        name: "不能重复归属",
        unitIds: [first.section.id],
      }),
    /已经属于/,
  );
  assert.equal(workspace(s, p).seasons.length, 1);
  const future = createSeason(s, p, { workflowId, name: "第二季" });
  const emptyOverview = productionMap(workspace(s, p), workflowId);
  assert.ok(hasEdge(emptyOverview, before.id, `season:${future.id}`));
  assert.ok(!hasEdge(emptyOverview, `season:${future.id}`, after.id));
  assert.deepEqual(workspace(s, p).dependencies, snapshot.dependencies);
  const second = appendUnit(s, p, {
    workflowId,
    seasonId: future.id,
    name: "第一集",
    kind: "episode",
    steps,
  });
  assert.notEqual(first.section.id, second.section.id);
  assert.equal(second.section.season_id, future.id);
  assert.throws(
    () =>
      appendUnit(s, p, {
        workflowId,
        seasonId: future.id,
        name: "第一集",
        kind: "episode",
        steps,
      }),
    /同名/,
  );
  const foreignP = String(createProject(s, { name: "另一个项目" }).id),
    foreignW = String(createWorkflow(s, foreignP, { name: "另一流程" })!.id);
  const foreignSeason = createSeason(s, foreignP, {
    workflowId: foreignW,
    name: "第一季",
  });
  assert.throws(
    () =>
      appendUnit(s, p, {
        workflowId,
        seasonId: foreignSeason.id,
        name: "越界",
        kind: "episode",
        steps,
      }),
    /不存在/,
  );
  assert.throws(
    () => createSeason(s, foreignP, { workflowId, name: "越界" }),
    /不存在/,
  );
  assert.throws(
    () =>
      createSeason(s, foreignP, {
        workflowId: foreignW,
        name: "越界分集",
        unitIds: [first.section.id],
      }),
    /不存在/,
  );
  assert.throws(
    () =>
      createSeason(s, p, {
        workflowId,
        name: "不接收前期分组",
        unitIds: [prep.id],
      }),
    /不存在/,
  );
  const map = productionMap(workspace(s, p), workflowId);
  const layout = layoutWorkflow(
    map.nodes.map((n) => ({ id: String(n.id) })),
    map.dependencies.map((e) => ({
      from: String(e.depends_on),
      to: String(e.node_id),
    })),
    "vertical",
    { width: 248, height: 108 },
  );
  assert.equal(layout.hasCycle, false);
  for (const edge of layout.edges) {
    assert.ok(
      layout.nodes.find((n) => n.id === edge.from)!.y <
        layout.nodes.find((n) => n.id === edge.to)!.y,
    );
  }
  for (let i = 0; i < layout.nodes.length; i++)
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i],
        b = layout.nodes[j];
      assert.ok(Math.abs(a.x - b.x) >= 248 || Math.abs(a.y - b.y) >= 108);
    }
});
