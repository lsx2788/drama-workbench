"use client";
import { useState } from "react";
import { api, str, type Workspace } from "@/client/api";
import { Badge, Empty, date } from "./ui";
import type { FormKind } from "./create-form";
export function DiscussionView({
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
  const [selected, setSelected] = useState(""),
    [quote, setQuote] = useState(""),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false);
  const session =
    w.sessions.find((s) => s.id === selected) ??
    w.sessions.find((s) => s.node_type === "coordinator") ??
    w.sessions[0];
  const messages = w.messages.filter((m) => m.session_id === session?.id);
  const quoted = w.messages.find((m) => m.id === quote);
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>沟通中心</h2>
          <p>与总控讨论，展开查看节点协作，把重要判断留在项目里。</p>
        </div>
        <button onClick={() => create("session")}>＋ 建立会话</button>
      </div>
      {!w.sessions.length ? (
        <Empty>
          先在流程节点中添加
          AI，再建立讨论会话。总控协调节点的会话是你的沟通入口。
        </Empty>
      ) : (
        <div className="discussion-layout">
          <aside className="session-list">
            {w.sessions.map((s) => (
              <button
                className={session?.id === s.id ? "selected" : ""}
                key={str(s, "id")}
                onClick={() => setSelected(str(s, "id"))}
              >
                <span className="avatar">
                  {s.node_type === "coordinator" ? "总" : "AI"}
                </span>
                <div>
                  <strong>{str(s, "title")}</strong>
                  <small>{str(s, "agent_name")}</small>
                </div>
              </button>
            ))}
          </aside>
          <section className="chat-panel">
            <div className="chat-header">
              <div>
                <strong>{session?.title as string}</strong>
                <small>
                  {session?.agent_name as string} ·{" "}
                  {session?.node_type === "coordinator"
                    ? "主对话"
                    : "协作讨论 · 只读"}
                </small>
              </div>
              <Badge value={String(session?.status)} />
            </div>
            <details className="session-meta">
              <summary>会话追溯信息</summary>
              <p>内部 ID：{session?.id as string}</p>
              <p>
                外部 ID：
                {(session?.external_session_id as string) || "尚未绑定"}
              </p>
              <p>前继会话：{(session?.predecessor_id as string) || "无"}</p>
            </details>
            <div className="messages">
              {messages.length ? (
                messages.map((m) => (
                  <article
                    key={str(m, "id")}
                    className={`message ${m.sender_type}`}
                  >
                    <div className="message-meta">
                      <strong>
                        {m.sender_type === "human"
                          ? "你"
                          : str(m, "agent_name")}
                      </strong>
                      <small>{date(m.created_at)}</small>
                    </div>
                    {m.quote_id ? (
                      <blockquote>
                        {str(
                          w.messages.find((x) => x.id === m.quote_id) ?? {},
                          "content",
                        )}
                      </blockquote>
                    ) : null}
                    <p className="pre">{str(m, "content")}</p>
                    <div className="message-actions">
                      <button
                        onClick={() => {
                          const coordinator = w.sessions.find(
                            (s) => s.node_type === "coordinator",
                          );
                          if (!coordinator) {
                            fail(new Error("请先建立总控会话"));
                            return;
                          }
                          setQuote(str(m, "id"));
                          setSelected(str(coordinator, "id"));
                        }}
                      >
                        引用给总控
                      </button>
                      <button
                        onClick={() =>
                          create("highlight", {
                            nodeId: str(m, "node_id"),
                            sourceMessageId: str(m, "id"),
                            content: str(m, "content"),
                          })
                        }
                      >
                        记录为重点
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty>围绕当前目标开始讨论。消息和引用会持续保存。</Empty>
              )}
            </div>
            {session?.node_type === "coordinator" ? (
              <form
                className="composer"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api(
                      `/projects/${p}/sessions/${session.id}/messages`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          content: draft,
                          ...(quote ? { quoteId: quote } : {}),
                        }),
                      },
                    );
                    setDraft("");
                    setQuote("");
                    await refresh();
                  } catch (err) {
                    fail(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {quoted && (
                  <div className="quote-preview">
                    <span>引用：{str(quoted, "content").slice(0, 150)}</span>
                    <button type="button" onClick={() => setQuote("")}>
                      取消引用
                    </button>
                  </div>
                )}
                <textarea
                  aria-label="给总控的消息"
                  placeholder="和总控说说你的想法…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  required
                />
                <div className="composer-footer">
                  <small>当前保存讨论；真实 AI 执行器尚未接入。</small>
                  <button className="primary" disabled={busy || !draft.trim()}>
                    发送给总控 ↗
                  </button>
                </div>
              </form>
            ) : (
              <div className="read-only">
                这是子 AI 协作会话。可引用消息，通过总控提出意见。
              </div>
            )}
          </section>
          <aside className="discussion-notes">
            <div className="panel-heading">
              <h3>节点重点</h3>
              <button
                onClick={() =>
                  create("highlight", { nodeId: String(session?.node_id) })
                }
              >
                ＋
              </button>
            </div>
            {w.highlights
              .filter(
                (h) =>
                  h.node_id === session?.node_id && h.status !== "superseded",
              )
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
        </div>
      )}
    </>
  );
}
