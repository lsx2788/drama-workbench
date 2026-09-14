"use client";
import { useId, useRef, useState, useEffect, useMemo } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
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
      ),
    [nodes, dependencies],
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(800);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const marker = useId().replaceAll(":", "");
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fit = Math.min(1, Math.max(0.25, (availableWidth - 2) / graph.width));
  const zoom = manualZoom ?? Math.max(0.65, fit);
  const positions = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <section className="workflow-graph" aria-label="制作流程图">
      <div className="graph-toolbar">
        <div>
          <strong>制作流程图</strong>
          <span>箭头表示前置依赖，点击节点查看详情</span>
        </div>
        <div className="graph-controls">
          <button
            aria-label="缩小流程图"
            disabled={zoom <= 0.25}
            onClick={() => setManualZoom(Math.max(0.25, zoom - 0.15))}
          >
            <Minus size={15} />
          </button>
          <span aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button
            aria-label="放大流程图"
            disabled={zoom >= 1.5}
            onClick={() => setManualZoom(Math.min(1.5, zoom + 0.15))}
          >
            <Plus size={15} />
          </button>
          <button
            onClick={() => {
              setManualZoom(fit);
              viewport.current?.scrollTo(0, 0);
            }}
          >
            <Maximize2 size={14} /> 适应宽度
          </button>
        </div>
      </div>
      {graph.hasCycle && (
        <p role="alert" className="error">
          依赖中存在循环，请检查节点关系。
        </p>
      )}
      <div className="graph-viewport" ref={viewport}>
        {!nodes.length ? (
          <Empty>
            这个流程还没有节点。添加节点并选择前置节点，连线会自动显示。
          </Empty>
        ) : (
          <div
            style={{ width: graph.width * zoom, height: graph.height * zoom }}
            className="graph-surface"
          >
            <div
              className="graph-canvas"
              style={{
                width: graph.width,
                height: graph.height,
                transform: `scale(${zoom})`,
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
                  const x = source.x + NODE_WIDTH,
                    y = source.y + NODE_HEIGHT / 2;
                  const endX = target.x - 5,
                    endY = target.y + NODE_HEIGHT / 2;
                  const bend = Math.max(38, (endX - x) / 2),
                    active = e.from === selectedId || e.to === selectedId;
                  return (
                    <path
                      key={`${e.from}:${e.to}`}
                      data-from={e.from}
                      data-to={e.to}
                      d={`M ${x} ${y} C ${x + bend} ${y}, ${endX - bend} ${endY}, ${endX} ${endY}`}
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
                    <span className="graph-node-objective">
                      {str(node, "objective") || "点击查看节点信息与聊天"}
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
      <div className="graph-caption">
        {nodes.length} 个节点 · {graph.edges.length} 条依赖 ·
        并行节点分行展示，较大流程可滚动查看
      </div>
    </section>
  );
}
