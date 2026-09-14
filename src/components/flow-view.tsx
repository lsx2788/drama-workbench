"use client";
import { WorkflowGraph } from "./workflow-graph";
import { NodeChats } from "./node-chats";
import type { ChatViewProps } from "./view-types";
import { api, str } from "@/client/api";
import { Badge, Empty, Panel, date } from "./ui";
export function FlowView({
  selectedWorkflowId,
  onSelectWorkflow,
  selectedNodeId,
  onSelectNode,
  ...props
}: ChatViewProps & {
  selectedWorkflowId: string;
  onSelectWorkflow: (workflowId: string) => void;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const { w, p, create, refresh, fail } = props;
  const selectedNode = w.nodes.find((n) => n.id === selectedNodeId);
  const workflow =
    w.workflows.find(
      (f) => f.id === (selectedNode?.workflow_id ?? selectedWorkflowId),
    ) ??
    w.overview.workflow ??
    w.workflows[0];
  const nodes = w.nodes.filter((n) => n.workflow_id === workflow?.id);
  const current = nodes.find((n) => n.id === selectedNodeId) ?? nodes[0];
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
    <>
      <div className="section-actions">
        <div>
          <h2>流程与事项</h2>
          <p>查看制作路径与推进情况，点击节点进入详情和讨论。</p>
        </div>
        <button onClick={() => refresh().catch(fail)}>刷新流程</button>
      </div>
      {!w.workflows.length ? (
        <Empty>暂无制作流程。总控根据讨论结果生成流程后，会展示在这里。</Empty>
      ) : (
        <div className="workflow-bar">
          {w.workflows.map((f) => (
            <div
              key={str(f, "id")}
              className={workflow?.id === f.id ? "selected" : ""}
            >
              <button
                aria-pressed={workflow?.id === f.id}
                onClick={() => {
                  onSelectWorkflow(str(f, "id"));
                  onSelectNode(
                    str(
                      w.nodes.find((n) => n.workflow_id === f.id) ?? {},
                      "id",
                    ),
                  );
                }}
              >
                <strong>{str(f, "name")}</strong>
              </button>
              <Badge value={str(f, "status")} />
            </div>
          ))}
        </div>
      )}
      {workflow && (
        <WorkflowGraph
          key={str(workflow, "id")}
          nodes={nodes}
          dependencies={w.dependencies}
          selectedId={current ? str(current, "id") : ""}
          onSelect={onSelectNode}
        />
      )}
      <div className="flow-details-layout">
        {current ? (
          <div className="node-detail">
            <Panel
              title={str(current, "name")}
              action={<Badge value={str(current, "status")} />}
            >
              <p>{str(current, "objective")}</p>
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
                  .map((d) => w.nodes.find((n) => n.id === d.depends_on)?.name)
                  .join("、") || "无"}
              </p>
            </Panel>
            <Panel
              title="当前讨论重点"
              action={
                <button
                  onClick={() =>
                    create("highlight", { nodeId: str(current, "id") })
                  }
                >
                  ＋ 记录
                </button>
              }
            >
              {w.highlights
                .filter(
                  (h) => h.node_id === current.id && h.status !== "superseded",
                )
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
                      <button
                        onClick={() => change(`highlights/${h.id}/confirm`)}
                      >
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
                <p className="muted">
                  暂无参与 AI。总控确定参与者后，会显示在这里。
                </p>
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
        ) : null}
      </div>
    </>
  );
}
