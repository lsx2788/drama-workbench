"use client";
import { useState } from "react";
import { str, type Workspace, type RecordData } from "@/client/api";
import { Badge, Empty, date } from "./ui";
import type { CreateAction } from "./view-types";
import { StoryPreview } from "./story-preview";
import { AgentPromptSettings, MessagePrompt } from "./agent-prompt-settings";
import { AiConnectionSettings } from "./ai-connection-settings";
import { useAiChat } from "./use-ai-chat";
import { StoryFileUpload } from "./story-file-upload";
import { ChatImages } from "./chat-images";
import { AiExecutionDetails } from "./ai-execution-details";

function messageAttachments(message: RecordData): RecordData[] {
  if (Array.isArray(message.attachments)) return message.attachments;
  return message.story_id
    ? [
        {
          id: message.story_id,
          title: message.story_title,
          download_url: message.story_download_url,
        },
      ]
    : [];
}

function messageDisplay(message: RecordData) {
  let content = str(message, "content");
  for (const attachment of messageAttachments(message)) {
    const sourcePath = str(attachment, "download_url");
    if (sourcePath)
      content = content
        .replace(`故事原文路径：${sourcePath}`, "")
        .replaceAll(sourcePath, "");
  }
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

function StoryMessage({
  p,
  message,
  stories,
}: {
  p: string;
  message: RecordData;
  stories: RecordData[];
}) {
  const attachments = messageAttachments(message);
  return (
    <>
      <p className="pre">{messageDisplay(message)}</p>
      {attachments.length > 0 && (
        <div className="story-message-attachments">
          {attachments.map((attachment) => {
            const storyId = str(attachment, "id");
            const filename =
              str(attachment, "original_name") ||
              str(
                stories.find((s) => s.id === storyId) ?? {},
                "original_name",
              ) ||
              str(attachment, "title");
            return (
              <StoryPreview
                key={storyId}
                p={p}
                storyId={storyId}
                filename={filename}
              />
            );
          })}
        </div>
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
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [fileError, setFileError] = useState("");
  const ai = useAiChat(p, str(session, "id"), refresh, fail);
  const busy = ai.sending || ai.running;
  const messages = w.messages.filter((m) => m.session_id === session.id);
  const quoted = w.messages.find((m) => m.id === quoteId);
  const latest = messages.at(-1);
  const pending =
    latest?.sender_type === "human" &&
    !ai.turns.some((t) => t.message_id === latest.id);
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
        <div className="chat-settings-actions">
          {session.node_type === "coordinator" && (
            <AiConnectionSettings
              value={ai.settings}
              changed={ai.loadSettings}
            />
          )}
          <AgentPromptSettings
            p={p}
            agentId={str(session, "agent_id")}
            refresh={refresh}
          />
          <Badge value={String(session?.status)} />
        </div>
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
      <AiExecutionDetails p={p} turns={ai.turns} />
      {session.node_type === "coordinator" && (
        <p className="muted" role="status">
          {ai.running
            ? "总控正在处理，回复和协作记录会自动更新…"
            : ai.settings?.configured
              ? `${ai.settings.provider === "codex" ? "本机 Codex" : "OpenAI API"} 已连接 · 消息、附件和生成结果会自动保存`
              : "消息已保存。连接 AI 后即可开始讨论。"}
        </p>
      )}
      <div className="messages">
        {messages.length ? (
          messages.map((m) => (
            <article key={str(m, "id")} className={`message ${m.sender_type}`}>
              <div className="message-meta">
                <strong>
                  {m.sender_type === "human"
                    ? "你"
                    : str(m, "sender_name") || str(m, "agent_name")}
                </strong>
                <small>{date(m.created_at)}</small>
              </div>
              {m.quote_id ? (
                <blockquote>
                  {messageDisplay(
                    w.messages.find((x) => x.id === m.quote_id) ?? {},
                  )}
                </blockquote>
              ) : null}
              <StoryMessage p={p} message={m} stories={w.stories} />
              <ChatImages images={m.images} />
              <div className="message-actions">
                <MessagePrompt
                  p={p}
                  messageId={str(m, "id")}
                  version={m.prompt_version}
                />
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
      {session.node_type === "coordinator" && (
        <>
          {ai.turns[0]?.error ? (
            <p role="alert" className="error">
              上次执行未完成：{str(ai.turns[0], "error")}。可发送补充消息继续。
            </p>
          ) : null}
          {pending && ai.settings?.configured && !busy && (
            <button
              type="button"
              className="pending-ai-message"
              onClick={() => void ai.send("", [], "", str(latest!, "id"))}
            >
              让总控处理这条消息
            </button>
          )}
        </>
      )}
      {session?.node_type === "coordinator" ? (
        <form
          className="composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await ai.send(draft, files, quoteId)) {
              setDraft("");
              setFiles([]);
              setAttachmentsOpen(false);
              onClearQuote();
            }
          }}
        >
          {quoted && (
            <div className="quote-preview">
              <span>引用：{messageDisplay(quoted).slice(0, 150)}</span>
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
            disabled={ai.sending}
          />
          {(attachmentsOpen || files.length > 0) && (
            <div className="chat-attachment-picker">
              <StoryFileUpload
                files={files}
                disabled={busy}
                onChange={setFiles}
                onError={setFileError}
              />
              {fileError && (
                <p className="error" role="alert">
                  {fileError}
                </p>
              )}
            </div>
          )}
          <div className="composer-footer">
            <button
              type="button"
              disabled={busy}
              onClick={() => setAttachmentsOpen(!attachmentsOpen)}
            >
              ＋ 文件 / 图片{files.length ? ` · ${files.length}` : ""}
            </button>
            <small>也可以直接告诉总控你想生成什么图片</small>
            <button
              className="primary"
              disabled={
                busy ||
                !ai.settings?.configured ||
                (!draft.trim() && !files.length)
              }
            >
              {ai.sending ? "发送中…" : ai.running ? "处理中…" : "发送 ↗"}
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
