"use client";
import { useMemo } from "react";
import type { Workspace } from "@/client/api";
import { productionMap, type FlowTarget } from "@/client/production-map";
import { WorkflowGraph } from "./workflow-graph";

export function ProductionFlow({
  w,
  workflowId,
  selectedId,
  onOpen,
}: {
  w: Workspace;
  workflowId: string;
  selectedId: string;
  onOpen: (target: FlowTarget) => void;
}) {
  const graph = useMemo(() => productionMap(w, workflowId), [w, workflowId]);
  return (
    <WorkflowGraph
      nodes={graph.nodes}
      dependencies={graph.dependencies}
      selectedId={selectedId}
      overview
      onSelect={(id) => {
        const target = graph.targets.get(id);
        if (target) onOpen(target);
      }}
    />
  );
}
