"use client";
import { useState } from "react";
import { api, str, type Workspace, type RecordData } from "@/client/api";
import { Badge, Empty, date } from "./ui";
import type { CreateAction } from "./view-types";
import { StoryLink } from "./story-link";

function StoryMessage({ p, message }: { p: string; message: RecordData }) {
  const content = str(message, "content");
  const sourcePath = str(message, "story_download_url");
  const storyId = str(message, "story_id");
  if (!storyId || !sourcePath) return <p className="pre">{content}</p>;
  const segments = content.split(sourcePath);
  return (
    <>
      <p className="pre">
        {segments.map((text, index) => (
          <span key={index}>
            {index > 0 && (
              <StoryLink p={p} storyId={storyId}>
                {sourcePath}
              </StoryLink>
            )}
            {text}
          </span>
        ))}
      </p>
      {segments.length === 1 && (
        <StoryLink p={p} storyId={storyId}>
          <span>故事原文：{str(message, "story_title")}</span>
          <small className="story-message-path">{sourcePath}</small>
        </StoryLink>
      )}
    </>
  );
}
export function ChatPanel({
  w,
  p,
  session,
  quoteId,
  create,
  refresh,
  fail,
  onQuote,
  onClearQuote,
}: {
  w: Workspace;
  p: string;
  session: RecordData;
  quoteId: string;
  create: CreateAction;
  refresh: () => Promise<void>;
  fail: (e: unknown) => void;
  onQuote: (messageId: string) => void;
  onClearQuote: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const messages = w.messages.filter((m) => m.session_id === session.id);
  const quoted = w.messages.find((m) => m.id === quoteId);
  return (
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
      {session.node_type === "coordinator" && (
        <p className="muted" role="status">
          消息已保存。总控 AI 执行器尚未接入，分析还未开始。
        </p>
      )}
      <div className="messages">
        {messages.length ? (
          messages.map((m) => (
            <article key={str(m, "id")} className={`message ${m.sender_type}`}>
              <div className="message-meta">
                <strong>
                  {m.sender_type === "human" ? "你" : str(m, "agent_name")}
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
              <StoryMessage p={p} message={m} />
              <div className="message-actions">
                <button
                  onClick={() => {
                    onQuote(str(m, "id"));
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
              await api(`/projects/${p}/sessions/${session.id}/messages`, {
                method: "POST",
                body: JSON.stringify({
                  content: draft,
                  ...(quoteId ? { quoteId } : {}),
                }),
              });
              setDraft("");
              onClearQuote();
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
              <button type="button" onClick={() => onClearQuote()}>
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
  );
}
