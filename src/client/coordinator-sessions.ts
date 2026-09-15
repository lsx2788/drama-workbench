import type { Workspace } from "./api";

export function coordinatorSessions(w: Workspace) {
  const workflowIds = w.overview.workflow
    ? [w.overview.workflow.id]
    : w.workflows.filter((f) => f.status === "draft").map((f) => f.id);
  return w.sessions.filter(
    (s) =>
      s.node_type === "coordinator" &&
      w.nodes.some(
        (n) => n.id === s.node_id && workflowIds.includes(n.workflow_id),
      ),
  );
}
