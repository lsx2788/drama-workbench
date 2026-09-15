import type { Store, Row } from "./db";
import { assert, audit } from "./common";

export function workflowStructure(s: Store, workflowId: string) {
  const nodes = s.all(
    "SELECT n.*,g.phase,m.section_id FROM nodes n LEFT JOIN node_sections m ON m.node_id=n.id LEFT JOIN workflow_sections g ON g.id=m.section_id WHERE n.workflow_id=?",
    workflowId,
  );
  const edges = s.all(
    "SELECT e.* FROM node_dependencies e JOIN nodes n ON n.id=e.node_id WHERE n.workflow_id=?",
    workflowId,
  );
  return { nodes, edges };
}

export function terminalNodes(nodes: Row[], edges: Row[]) {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes.filter(
    (n) => !edges.some((e) => e.depends_on === n.id && ids.has(e.node_id)),
  );
}

/** Extending production may add archive gates, so existing delivery must still be unstarted. */
export function assertProductionCanExpand(s: Store, workflowId: string) {
  const delivery = workflowStructure(s, workflowId).nodes.filter(
    (n) => n.phase === "delivery",
  );
  assert(
    delivery.every((n) => n.status === "planned"),
    "全剧汇总已开始，请先处理汇总状态再扩展制作流程",
  );
  for (const node of delivery)
    assert(
      !s.one(
        "SELECT id FROM items WHERE node_id=? AND status NOT IN ('planned','cancelled')",
        String(node.id),
      ),
      "汇总事项已开始，不能插入新的制作前置依赖",
    );
}

function wouldCycle(edges: Row[], from: unknown, to: unknown) {
  const visited = new Set<unknown>(),
    queue = [to];
  while (queue.length) {
    const current = queue.pop();
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges)
      if (edge.depends_on === current) queue.push(edge.node_id);
  }
  return false;
}

/** Add missing gates only. Historical dependencies and ordinary work nodes never get rewritten. */
export function syncDeliveryGates(s: Store, p: string, workflowId: string) {
  const { nodes, edges } = workflowStructure(s, workflowId);
  const production = nodes.filter(
    (n) => n.phase !== "delivery" && n.node_type !== "coordinator",
  );
  const delivery = nodes.filter((n) => n.phase === "delivery");
  const starts = delivery.filter(
    (n) =>
      !edges.some(
        (e) =>
          e.node_id === n.id &&
          delivery.some((other) => other.id === e.depends_on),
      ),
  );
  const added: { nodeId: string; dependsOn: string }[] = [];
  for (const target of starts)
    for (const source of terminalNodes(production, edges)) {
      if (
        edges.some((e) => e.node_id === target.id && e.depends_on === source.id)
      )
        continue;
      assert(
        target.status === "planned" &&
          !s.one(
            "SELECT id FROM items WHERE node_id=? AND status NOT IN ('planned','cancelled')",
            String(target.id),
          ),
        "汇总已开始，不能改变其前置依赖",
      );
      assert(
        !wouldCycle(edges, source.id, target.id),
        "新增节点会使归档依赖形成循环，请检查前置关系",
      );
      s.run(
        "INSERT INTO node_dependencies VALUES(?,?)",
        String(target.id),
        String(source.id),
      );
      edges.push({ node_id: target.id, depends_on: source.id });
      added.push({ nodeId: String(target.id), dependsOn: String(source.id) });
    }
  if (added.length)
    audit(s, p, "workflow.delivery_gates_added", workflowId, { added });
}

/** A declared unit with no production steps is unfinished planning, not a completed episode. */
export function assertDeliveryReady(s: Store, nodeId: string) {
  const node = s.one(
    "SELECT n.workflow_id,g.phase FROM nodes n JOIN node_sections m ON m.node_id=n.id JOIN workflow_sections g ON g.id=m.section_id WHERE n.id=?",
    nodeId,
  );
  if (node?.phase !== "delivery") return;
  assert(
    !s.one(
      "SELECT g.id FROM workflow_sections g WHERE g.workflow_id=? AND g.phase='unit' AND NOT EXISTS(SELECT 1 FROM node_sections m JOIN nodes n ON n.id=m.node_id WHERE m.section_id=g.id AND n.node_type='work')",
      String(node.workflow_id),
    ),
    "还有分集/章节尚未定义制作步骤，不能开始归档",
  );
}
