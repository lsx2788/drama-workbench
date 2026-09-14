"use client";
import { str } from "@/client/api";
import { ProductionFlow } from "./production-flow";
import { NodeDetails } from "./node-details";
import { Dialog, Empty } from "./ui";
import type { ChatViewProps } from "./view-types";
export function FlowView({
  selectedNodeId,
  onSelectNode,
  ...props
}: ChatViewProps & {
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
}) {
  const { w } = props;
  const workflow =
    w.overview.workflow ?? w.workflows.find((f) => f.status === "draft");
  const nodes = w.nodes.filter((n) => n.workflow_id === workflow?.id);
  const current = nodes.find((n) => n.id === selectedNodeId);
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>制作流程</h2>
          <p>{str(w.overview.project, "description")}</p>
        </div>
      </div>
      {workflow ? (
        <ProductionFlow
          key={str(workflow, "id")}
          w={w}
          workflowId={str(workflow, "id")}
          selectedId={selectedNodeId}
          onSelect={onSelectNode}
        />
      ) : (
        <Empty>暂无制作流程。总控根据讨论结果生成后，将展示在这里。</Empty>
      )}
      {current && (
        <Dialog title={str(current, "name")} onClose={() => onSelectNode("")}>
          <NodeDetails current={current} {...props} />
        </Dialog>
      )}
    </>
  );
}
