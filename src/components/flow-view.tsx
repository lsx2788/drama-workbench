"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { str, type Workspace } from "@/client/api";
import { unitProgress } from "@/client/production-map";
import { ProductionFlow } from "./production-flow";
import { WorkflowGraph } from "./workflow-graph";
import { Badge, Dialog, Panel } from "./ui";
export function FlowView({
  w,
  onSelectNode,
}: {
  w: Workspace;
  onSelectNode: (id: string) => void;
}) {
  const [unitId, setUnitId] = useState(""),
    [seasonId, setSeasonId] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    previousUnit = useRef(unitId);
  useEffect(() => {
    if (previousUnit.current === unitId) return;
    previousUnit.current = unitId;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [unitId]);
  const workflow = w.overview.workflow;
  const nodes = w.nodes.filter((n) => n.workflow_id === workflow?.id);
  const published = !!workflow && nodes.some((n) => n.node_type === "work");
  const unit = w.sections.find(
    (s) => s.id === unitId && s.workflow_id === workflow?.id,
  );
  const season = w.seasons.find(
    (s) => s.id === seasonId && s.workflow_id === workflow?.id,
  );
  const unitNodes = nodes.filter((n) => n.section_id === unit?.id);
  const enterUnit = (id: string) => {
    setUnitId(id);
    setSeasonId("");
  };
  if (!published) return null;
  return (
    <>
      <div className="section-actions">
        <div>
          <h2 className="flow-heading" ref={heading} tabIndex={-1}>
            {unit ? str(unit, "name") : "制作流程"}
          </h2>
          <p>
            {unit
              ? str(
                  w.seasons.find((s) => s.id === unit.season_id) ??
                    w.overview.project,
                  "name",
                )
              : str(w.overview.project, "description")}
          </p>
        </div>
      </div>
      {unit ? (
        <>
          <div className="unit-navigation">
            <button
              onClick={() => {
                setUnitId("");
              }}
            >
              <ArrowLeft size={16} /> 返回总流程
            </button>
            <span>
              {unitNodes.length
                ? `${unitProgress(unitNodes).completed} / ${unitNodes.length} 个步骤完成`
                : "制作步骤待讨论"}
            </span>
          </div>
          <WorkflowGraph
            nodes={unitNodes}
            dependencies={w.dependencies}
            selectedId=""
            onSelect={onSelectNode}
          />
        </>
      ) : workflow ? (
        <ProductionFlow
          key={str(workflow, "id")}
          w={w}
          workflowId={str(workflow, "id")}
          selectedId=""
          onOpen={(target) => {
            if (target.kind === "node") onSelectNode(target.id);
            else if (target.kind === "unit") enterUnit(target.id);
            else setSeasonId(target.id);
          }}
        />
      ) : null}
      {season && (
        <Dialog title={str(season, "name")} onClose={() => setSeasonId("")}>
          <Panel title="本季内容">
            {season.description ? (
              <p className="pre">{str(season, "description")}</p>
            ) : null}
            <div className="season-units">
              {w.sections
                .filter((s) => s.season_id === season.id)
                .map((s) => {
                  const progress = unitProgress(
                    nodes.filter((n) => n.section_id === s.id),
                  );
                  return (
                    <button
                      key={str(s, "id")}
                      onClick={() => enterUnit(str(s, "id"))}
                    >
                      <strong>{str(s, "name")}</strong>
                      <Badge value={progress.status} />
                      <span>进入 →</span>
                    </button>
                  );
                })}
            </div>
            {!w.sections.some((s) => s.season_id === season.id) && (
              <p className="muted">
                本季分集尚未定义。讨论确定后，会显示在这里。
              </p>
            )}
          </Panel>
        </Dialog>
      )}
    </>
  );
}
