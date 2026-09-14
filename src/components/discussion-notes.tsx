import { str, type Workspace } from "@/client/api";
import { Badge } from "./ui";
import type { CreateAction } from "./view-types";
export function DiscussionNotes({
  w,
  nodeId,
  create,
}: {
  w: Workspace;
  nodeId: string;
  create: CreateAction;
}) {
  return (
    <aside className="discussion-notes">
      <div className="panel-heading">
        <h3>节点重点</h3>
        <button onClick={() => create("highlight", { nodeId: nodeId })}>
          ＋
        </button>
      </div>
      {w.highlights
        .filter((h) => h.node_id === nodeId && h.status !== "superseded")
        .map((h) => (
          <div className="highlight" key={str(h, "id")}>
            <Badge value={str(h, "kind")} />
            <Badge value={str(h, "status")} />
            <p>{str(h, "content")}</p>
            <small>{str(h, "rationale")}</small>
          </div>
        ))}
      <p className="muted">
        重点独立保存，可回溯来源。提议不会自动变成已确认结论。
      </p>
    </aside>
  );
}
