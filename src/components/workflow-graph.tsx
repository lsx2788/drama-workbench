"use client";
import { useId, useMemo } from "react";
import { str, type RecordData } from "@/client/api";
import {
  layoutWorkflow,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "@/client/workflow-layout";
import { Badge, Empty } from "./ui";

export function WorkflowGraph({
  nodes,
  dependencies,
  selectedId,
  onSelect,
}: {
  nodes: RecordData[];
  dependencies: RecordData[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const graph = useMemo(
    () =>
      layoutWorkflow(
        nodes.map((n) => ({ id: str(n, "id") })),
        dependencies.map((d) => ({
          from: str(d, "depends_on"),
          to: str(d, "node_id"),
        })),
        "vertical",
      ),
    [nodes, dependencies],
  );
  const marker = useId().replaceAll(":", "");
  const positions = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <section className="workflow-graph" aria-label="制作流程图">
      {graph.hasCycle && (
        <p role="alert" className="error">
          依赖中存在循环，请检查节点关系。
        </p>
      )}
      <div className="graph-viewport">
        {!nodes.length ? (
          <Empty>
            这个流程暂时没有节点。节点及其依赖生成后，会展示在这里。
          </Empty>
        ) : (
          <div
            style={{ width: graph.width, height: graph.height }}
            className="graph-surface"
          >
            <div
              className="graph-canvas"
              style={{
                width: graph.width,
                height: graph.height,
              }}
            >
              <svg
                width={graph.width}
                height={graph.height}
                className="graph-edges"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={`${marker}-arrow`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#a3b6ac" />
                  </marker>
                  <marker
                    id={`${marker}-selected`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#254e42" />
                  </marker>
                </defs>
                {graph.edges.map((e) => {
                  const source = positions.get(e.from)!,
                    target = positions.get(e.to)!;
                  const x = source.x + NODE_WIDTH / 2,
                    y = source.y + NODE_HEIGHT;
                  const endX = target.x + NODE_WIDTH / 2,
                    endY = target.y - 5;
                  const bend = Math.max(38, (endY - y) / 2),
                    active = e.from === selectedId || e.to === selectedId;
                  const edgePath =
                    endY - y > 150
                      ? `M ${x} ${y} L ${x} ${y + 24} L ${graph.width - 12} ${y + 24} L ${graph.width - 12} ${endY - 24} L ${endX} ${endY - 24} L ${endX} ${endY}`
                      : `M ${x} ${y} C ${x} ${y + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
                  return (
                    <path
                      key={`${e.from}:${e.to}`}
                      data-from={e.from}
                      data-to={e.to}
                      d={edgePath}
                      fill="none"
                      stroke={active ? "#254e42" : "#a3b6ac"}
                      strokeWidth={active ? 2.5 : 1.8}
                      markerEnd={`url(#${marker}-${active ? "selected" : "arrow"})`}
                    />
                  );
                })}
              </svg>
              {graph.nodes.map((position) => {
                const node = nodes.find((n) => n.id === position.id)!;
                return (
                  <button
                    key={position.id}
                    className={`graph-node ${position.id === selectedId ? "selected" : ""}`}
                    aria-label={`查看节点：${str(node, "name")}`}
                    aria-pressed={position.id === selectedId}
                    onClick={() => onSelect(position.id)}
                    style={{
                      left: position.x,
                      top: position.y,
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                    }}
                  >
                    <span className="graph-node-title">
                      <strong>{str(node, "name")}</strong>
                      <Badge value={str(node, "status")} />
                    </span>
                    <span className="graph-node-footer">
                      {node.node_type === "coordinator"
                        ? "总控协调"
                        : "制作节点"}
                      <span>查看详情 ↗</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
