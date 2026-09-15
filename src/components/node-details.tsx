"use client";
import { api, str, type RecordData } from "@/client/api";
import { Badge, Panel, date } from "./ui";
import { NodeChats } from "./node-chats";
import type { ChatViewProps } from "./view-types";
export function NodeDetails({
  current,
  ...props
}: ChatViewProps & { current: RecordData }) {
  const { w, p, create, refresh, fail } = props;
  async function change(path: string, body?: unknown, method = "POST") {
    try {
      await api(`/projects/${p}/${path}`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh();
    } catch (e) {
      fail(e);
    }
  }
  return (
    <div className="node-detail">
      {current.node_type === "coordinator" && (
        <Panel title="项目基本信息">
          <h3>{str(w.overview.project, "name")}</h3>
          <p className="pre">{str(w.overview.project, "description")}</p>
          <p className="pre">{str(w.overview.project, "goal")}</p>
          {w.documents
            .filter(
              (d) =>
                d.kind === "outline" &&
                !w.documents.some((other) => other.supersedes_id === d.id),
            )
            .map((d) => (
              <details className="project-outline" key={str(d, "id")}>
                <summary>{str(d, "title")}</summary>
                <p className="pre">{str(d, "content")}</p>
              </details>
            ))}
        </Panel>
      )}
      <Panel
        title={str(current, "name")}
        action={<Badge value={str(current, "status")} />}
      >
        <p className="pre">{str(current, "objective")}</p>
        {current.section_id ? (
          <p className="muted">
            所属分组：
            {str(
              w.sections.find((s) => s.id === current.section_id) ?? {},
              "name",
            )}
          </p>
        ) : null}
        <p className="muted">
          所属流程：
          {str(
            w.workflows.find((f) => f.id === current.workflow_id) ?? {},
            "name",
          )}
        </p>
        <p className="muted">
          前置节点：
          {w.dependencies
            .filter((d) => d.node_id === current.id)
            .map((d) => {
              const node = w.nodes.find((n) => n.id === d.depends_on);
              const section = w.sections.find((s) => s.id === node?.section_id);
              return `${section?.phase === "unit" ? `${str(section, "name")} / ` : ""}${str(node ?? {}, "name")}`;
            })
            .join("、") || "无"}
        </p>
      </Panel>
      <Panel
        title="当前讨论重点"
        action={
          <button
            onClick={() => create("highlight", { nodeId: str(current, "id") })}
          >
            ＋ 记录
          </button>
        }
      >
        {w.highlights
          .filter((h) => h.node_id === current.id && h.status !== "superseded")
          .map((h) => (
            <div className="highlight" key={str(h, "id")}>
              <div className="row">
                <Badge value={str(h, "kind")} />
                <Badge value={str(h, "status")} />
                <small>{date(h.created_at)}</small>
              </div>
              <p>{str(h, "content")}</p>
              {h.rationale ? <small>{str(h, "rationale")}</small> : null}
              {h.status === "proposed" && (
                <button onClick={() => change(`highlights/${h.id}/confirm`)}>
                  确认结论
                </button>
              )}
              <div>
                <small className="mono">{str(h, "id")}</small>
              </div>
            </div>
          ))}
        {!w.highlights.some((h) => h.node_id === current.id) && (
          <p className="muted">
            把关键决定和待解决问题保存到这里，回看时不必翻完整聊天。
          </p>
        )}
      </Panel>
      <NodeChats
        key={str(current, "id")}
        {...props}
        nodeId={str(current, "id")}
      />
      <Panel title="节点内的 AI">
        {w.agents
          .filter((a) => a.node_id === current.id)
          .map((a) => (
            <details className="agent-card" key={str(a, "id")}>
              <summary>
                <span className="avatar">AI</span>
                <strong>{str(a, "name")}</strong>
                <span>{str(a, "purpose")}</span>
              </summary>
              <p className="pre">
                {str(a, "instructions") || "尚未配置提示词"}
              </p>
              <p className="mono">
                {str(a, "provider")} · {str(a, "model") || "未配置模型"} ·{" "}
                {str(a, "tools_json")}
              </p>
              <button
                onClick={() =>
                  create("session", {
                    agentId: str(a, "id"),
                    nodeId: str(current, "id"),
                  })
                }
              >
                添加聊天
              </button>
            </details>
          ))}
        {!w.agents.some((a) => a.node_id === current.id) && (
          <p className="muted">暂无参与 AI。总控确定参与者后，会显示在这里。</p>
        )}
      </Panel>
      <Panel title="工作事项">
        {w.items
          .filter((i) => i.node_id === current.id)
          .map((i) => (
            <div className="item" key={str(i, "id")}>
              <div className="row">
                <strong>{str(i, "title")}</strong>
                <Badge value={str(i, "status")} />
              </div>
              <p>{str(i, "acceptance") || str(i, "objective")}</p>
              {i.block_reason ? (
                <p className="muted">{str(i, "block_reason")}</p>
              ) : null}
              <div className="buttons">
                {i.status === "review" && (
                  <button
                    onClick={() =>
                      change(
                        `items/${i.id}`,
                        {
                          status: "completed",
                          reason: "由本地负责人确认交付完成",
                        },
                        "PATCH",
                      )
                    }
                  >
                    确认完成
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      const ctx = await api(
                        `/projects/${p}/items/${i.id}/context`,
                      );
                      window.alert(JSON.stringify(ctx, null, 2));
                    } catch (e) {
                      fail(e);
                    }
                  }}
                >
                  查看输入
                </button>
              </div>
              <small className="mono">{str(i, "id")}</small>
            </div>
          ))}
      </Panel>
    </div>
  );
}
