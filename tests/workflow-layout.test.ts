import test from "node:test";
import assert from "node:assert/strict";
import {
  layoutWorkflow,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "../src/client/workflow-layout";

test("branch and merge layouts respect prerequisites and never overlap", () => {
  const graph = layoutWorkflow(
    ["merge", "right", "start", "left"].map((id) => ({ id })),
    [
      { from: "start", to: "left" },
      { from: "start", to: "right" },
      { from: "left", to: "merge" },
      { from: "right", to: "merge" },
    ],
  );
  const positions = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges)
    assert.ok(positions.get(e.to)!.x > positions.get(e.from)!.x + NODE_WIDTH);
  for (const a of graph.nodes)
    for (const b of graph.nodes)
      if (a.id !== b.id)
        assert.ok(
          Math.abs(a.x - b.x) >= NODE_WIDTH ||
            Math.abs(a.y - b.y) >= NODE_HEIGHT,
        );
  assert.equal(graph.hasCycle, false);
});
test("unconnected nodes stay unconnected and out-of-workflow edges are omitted", () => {
  const graph = layoutWorkflow(
    [{ id: "a" }, { id: "b" }],
    [{ from: "other-workflow", to: "a" }],
  );
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.nodes[0].x, graph.nodes[1].x);
  assert.notEqual(graph.nodes[0].y, graph.nodes[1].y);
  assert.equal(layoutWorkflow([], []).nodes.length, 0);
});
test("cyclic imported data is flagged and remains inspectable", () => {
  const graph = layoutWorkflow(
    [{ id: "a" }, { id: "b" }],
    [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  );
  assert.equal(graph.hasCycle, true);
  assert.equal(graph.nodes.length, 2);
  assert.ok(Number.isFinite(graph.height));
});
