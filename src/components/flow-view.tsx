"use client";
import { useState } from "react";
import { str } from "@/client/api";
import { unitProgress } from "@/client/production-map";
import { ProductionFlow } from "./production-flow";
import { WorkflowGraph } from "./workflow-graph";
import { Badge, Dialog, Panel } from "./ui";
import { EpisodeContent } from "./episode-content";
import { StoryKnowledge } from "./story-knowledge";
import { PromptDialog } from "./prompt-dialog";
import { FlowNodeDialog } from "./flow-node-dialog";
import type { ChatViewProps } from "./view-types";
export function FlowView(props: ChatViewProps) {
  const { w } = props;
  const [nodeId, setNodeId] = useState("");
  const [unitId, setUnitId] = useState(""),
    [seasonId, setSeasonId] = useState("");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
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
  const node = nodes.find((n) => n.id === nodeId);
  const enterUnit = (id: string) => setUnitId(id);
  const quoteToCoordinator = (id: string) => {
    setNodeId("");
    setUnitId("");
    setSeasonId("");
    setKnowledgeOpen(false);
    props.onQuote(id);
  };
  if (!published) return null;
  return (
    <>
      <div className="section-actions">
        <div>
          <h2 className="flow-heading">制作流程</h2>
          <p>{str(w.overview.project, "description")}</p>
        </div>
      </div>
      {workflow && (
        <ProductionFlow
          key={str(workflow, "id")}
          w={w}
          workflowId={str(workflow, "id")}
          selectedId=""
          onOpen={(target) => {
            if (target.kind === "node") setNodeId(target.id);
            else if (target.kind === "unit") enterUnit(target.id);
            else if (target.kind === "knowledge") setKnowledgeOpen(true);
            else setSeasonId(target.id);
          }}
        />
      )}
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
      {unit && (
        <PromptDialog
          title={str(unit, "name")}
          onClose={() => setUnitId("")}
          closeLabel="关闭剧集详情"
        >
          <p className="muted">
            {unitNodes.length
              ? `${unitProgress(unitNodes).completed} / ${unitNodes.length} 个步骤完成`
              : "制作步骤待讨论"}
          </p>
          {!!unitNodes.length && (
            <WorkflowGraph
              nodes={unitNodes}
              dependencies={w.dependencies}
              selectedId=""
              onSelect={setNodeId}
            />
          )}
          <EpisodeContent
            key={str(unit, "id")}
            p={str(w.overview.project, "id")}
            unitId={str(unit, "id")}
            w={w}
            onSelect={enterUnit}
          />
        </PromptDialog>
      )}
      {node && (
        <FlowNodeDialog
          key={str(node, "id")}
          {...props}
          current={node}
          onClose={() => setNodeId("")}
          onQuote={quoteToCoordinator}
        />
      )}
      {knowledgeOpen && (
        <PromptDialog title="故事资料" onClose={() => setKnowledgeOpen(false)}>
          <StoryKnowledge w={w} p={str(w.overview.project, "id")} />
        </PromptDialog>
      )}
    </>
  );
}
