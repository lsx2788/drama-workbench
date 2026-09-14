export interface GraphNode {
  id: string;
}
export interface GraphEdge {
  from: string;
  to: string;
}
export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
}
export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 120;
const COLUMN_GAP = 96;
const ROW_GAP = 40;
const PADDING = 32;

/** Place each node after all of its prerequisites. Unconnected nodes remain peers. */
export function layoutWorkflow(nodes: GraphNode[], dependencies: GraphEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [
    ...new Map(
      dependencies
        .filter((e) => ids.has(e.from) && ids.has(e.to))
        .map((e) => [`${e.from}:${e.to}`, e]),
    ).values(),
  ];
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const children = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) {
    incoming.set(e.to, incoming.get(e.to)! + 1);
    children.get(e.from)!.push(e.to);
  }
  const ranks = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    for (const child of children.get(id)!) {
      ranks.set(child, Math.max(ranks.get(child)!, ranks.get(id)! + 1));
      incoming.set(child, incoming.get(child)! - 1);
      if (incoming.get(child) === 0) queue.push(child);
    }
  }
  const hasCycle = queue.length !== nodes.length;
  const maxRank = Math.max(0, ...ranks.values());
  // Invalid imported graphs remain inspectable; never invent missing connections.
  if (hasCycle)
    for (const n of nodes)
      if (incoming.get(n.id)! > 0) ranks.set(n.id, maxRank + 1);
  const columns = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const rank = ranks.get(n.id)!;
    columns.set(rank, [...(columns.get(rank) ?? []), n]);
  }
  const rows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const height = PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;
  const placed: PlacedNode[] = [];
  for (const [rank, column] of columns) {
    const columnHeight =
      column.length * NODE_HEIGHT + (column.length - 1) * ROW_GAP;
    column.forEach((n, row) =>
      placed.push({
        id: n.id,
        x: PADDING + rank * (NODE_WIDTH + COLUMN_GAP),
        y: (height - columnHeight) / 2 + row * (NODE_HEIGHT + ROW_GAP),
      }),
    );
  }
  return {
    nodes: placed,
    edges,
    hasCycle,
    height,
    width:
      PADDING * 2 +
      NODE_WIDTH +
      Math.max(0, ...columns.keys()) * (NODE_WIDTH + COLUMN_GAP),
  };
}
