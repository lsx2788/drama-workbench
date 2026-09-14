"use client";
import { ArrowDown, ChevronRight } from "lucide-react";
import { str, type Workspace, type RecordData } from "@/client/api";
import { WorkflowGraph } from "./workflow-graph";
export function ProductionFlow({
  w,
  workflowId,
  selectedId,
  onSelect,
}: {
  w: Workspace;
  workflowId: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const nodes = w.nodes.filter((n) => n.workflow_id === workflowId);
  const sections = w.sections.filter((s) => s.workflow_id === workflowId);
  const graph = (group: RecordData[]) => (
    <WorkflowGraph
      nodes={group}
      dependencies={w.dependencies}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
  if (!sections.length) return graph(nodes);
  const bySection = (section: RecordData) =>
    nodes.filter((n) => n.section_id === section.id);
  const phases = [
    { key: "preparation", label: "全剧规划与共用资产", number: "01" },
    { key: "unit", label: "分集 / 章节制作", number: "02" },
    { key: "delivery", label: "全剧汇总与交付", number: "03" },
  ];
  return (
    <div className="production-flow">
      {phases.map((phase, index) => (
        <div key={phase.key}>
          {index > 0 && (
            <div className="phase-arrow" aria-hidden="true">
              <ArrowDown size={22} />
            </div>
          )}
          <section
            className={`production-phase phase-${phase.key}`}
            aria-label={phase.label}
          >
            <header>
              <span>{phase.number}</span>
              <h3>{phase.label}</h3>
              {phase.key === "unit" && (
                <small>
                  {sections.filter((s) => s.phase === "unit").length} 个制作单元
                  · 可逐集扩展
                </small>
              )}
            </header>
            {sections
              .filter((s) => s.phase === phase.key)
              .map((section) => {
                const group = bySection(section);
                return phase.key === "unit" ? (
                  <details className="production-unit" key={str(section, "id")}>
                    <summary>
                      <ChevronRight size={17} />
                      <strong>{str(section, "name")}</strong>
                      <span>
                        {group.filter((n) => n.status === "completed").length} /{" "}
                        {group.length} 节点完成
                      </span>
                    </summary>
                    <div className="unit-flow">{graph(group)}</div>
                  </details>
                ) : (
                  <div key={str(section, "id")}>{graph(group)}</div>
                );
              })}
          </section>
        </div>
      ))}
      {nodes.some((n) => !n.section_id) && (
        <section className="production-phase">
          <header>
            <h3>其他节点</h3>
          </header>
          {graph(nodes.filter((n) => !n.section_id))}
        </section>
      )}
    </div>
  );
}
