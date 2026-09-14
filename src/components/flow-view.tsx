"use client";
import { useState } from "react";
import { api, str, type Workspace } from "@/client/api";
import { Badge, Empty, Panel, date } from "./ui";
import type { FormKind } from "./create-form";
export function FlowView({
  w,
  p,
  create,
  refresh,
  fail,
}: {
  w: Workspace;
  p: string;
  create: (k: FormKind, defaults?: Record<string, string>) => void;
  refresh: () => Promise<void>;
  fail: (e: unknown) => void;
}) {
  const [selected, setSelected] = useState("");
  const current = w.nodes.find((n) => n.id === selected) ?? w.nodes[0];
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
          <p>流程随故事确定，每个节点都保留自己的 AI、重点和成果。</p>
        </div>
        <div className="buttons">
          <button onClick={() => create("workflow")}>新建流程</button>
          <button className="primary" onClick={() => create("node")}>
            ＋ 添加节点
          </button>
        </div>
      </div>
      {!w.workflows.length ? (
        <Empty>还没有制作流程。先创建草案，再根据讨论添加节点。</Empty>
      ) : (
        <div className="workflow-bar">
          {w.workflows.map((f) => (
            <div key={str(f, "id")}>
              <strong>{str(f, "name")}</strong>
              <Badge value={str(f, "status")} />
              {f.status === "draft" && (
                <button onClick={() => change(`workflows/${f.id}/activate`)}>
                  发布流程
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flow-layout">
        <div className="node-list">
          {w.nodes.map((n, i) => (
            <button
              key={str(n, "id")}
              className={`node-card ${current?.id === n.id ? "selected" : ""}`}
              onClick={() => setSelected(str(n, "id"))}
            >
              <span className="node-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{str(n, "name")}</strong>
                <small>{str(n, "objective") || "尚未填写节点目标"}</small>
                <Badge value={str(n, "status")} />
              </div>
            </button>
          ))}
        </div>
        {current ? (
          <div className="node-detail">
            <Panel
              title={str(current, "name")}
              action={
                <select
                  aria-label="节点状态"
                  value={str(current, "status")}
                  onChange={(e) =>
                    change(
                      `nodes/${current.id}`,
                      { status: e.target.value },
                      "PATCH",
                    )
                  }
                >
                  <option value="planned">待准备</option>
                  <option value="active">进行中</option>
                  <option value="blocked">阻塞</option>
                  <option value="review">待审核</option>
                  <option value="completed">完成</option>
                </select>
              }
            >
              <p>{str(current, "objective")}</p>
              <small className="mono">节点 ID · {str(current, "id")}</small>
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
            <Panel
              title="节点内的 AI"
              action={
                <button
                  onClick={() =>
                    create("agent", { nodeId: str(current, "id") })
                  }
                >
                  ＋ 添加 AI
                </button>
              }
            >
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
                        create("session", { agentId: str(a, "id") })
                      }
                    >
                      建立会话
                    </button>
                  </details>
                ))}
              {!w.agents.some((a) => a.node_id === current.id) && (
                <p className="muted">一个节点可以有多个不同定位的 AI。</p>
              )}
            </Panel>
            <Panel
              title="工作事项"
              action={
                <button
                  onClick={() => create("item", { nodeId: str(current, "id") })}
                >
                  ＋ 新事项
                </button>
              }
            >
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
                      <button
                        onClick={() =>
                          change(`items/${i.id}`, { status: "ready" }, "PATCH")
                        }
                      >
                        准备就绪
                      </button>
                      <button
                        onClick={() =>
                          change(`items/${i.id}`, { status: "review" }, "PATCH")
                        }
                      >
                        提交审核
                      </button>
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
