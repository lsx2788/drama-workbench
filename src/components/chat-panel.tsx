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
import { GroupMembers, MentionPicker } from "./group-chat-controls";
import { ChatMarkdown } from "./chat-markdown";

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
  let content =
    typeof message.display_content === "string"
      ? message.display_content
      : str(message, "content");
  for (const attachment of messageAttachments(message)) {
    const sourcePath = str(attachment, "download_url");
    if (sourcePath)
      content = content
        .replace(`故事原文路径：${sourcePath}`, "")
        .replaceAll(sourcePath, "");
  }
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

/** Use delivery and sender identities, never guess the audience from the prose. */
function repliesToUser(
  message: RecordData,
  coordinator: RecordData,
  messages: RecordData[],
) {
  if (message.sender_type !== "agent") return false;
  const group = message.group as RecordData | null;
  const recipients = (group?.recipients as RecordData[]) ?? [];
  if (recipients.some((r) => r.session_id !== coordinator.id)) return false;
  if (
    message.sender_id === coordinator.agent_id &&
    message.session_id === coordinator.id
  )
    return true;
  return messages.some(
    (m) => m.id === group?.reply_to_id && m.sender_type === "human",
  );
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
      <ChatMarkdown text={messageDisplay(message)} />
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
  const [mentions, setMentions] = useState<RecordData[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const ai = useAiChat(p, str(session, "id"), refresh, fail);
  const busy = ai.sending || ai.running;
  const isGroup = session.node_type === "coordinator";
  const members = (w.groupCandidates ?? []).filter(
    (m) => m.group_id === session.id,
  );
  const selectedMentions = mentions.filter((m) =>
    draft.includes(`@${str(m, "name")}`),
  );
  const unavailableMention = selectedMentions.some(
    (m) =>
      !members.some((r) => r.id === m.id && r.membership_status === "active"),
  );
  const messages = w.messages.filter((m) =>
    isGroup
      ? (m.group as RecordData | null)?.group_id === session.id ||
        m.session_id === session.id
      : m.session_id === session.id ||
        (
          ((m.group as RecordData | null)?.recipients as RecordData[]) ?? []
        ).some((r) => r.session_id === session.id),
  );
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
              ? "项目讨论群"
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
      {isGroup && <GroupMembers members={members} />}
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
          messages.map((m) => {
            const forUser = isGroup && repliesToUser(m, session, w.messages);
            return (
              <article
                key={str(m, "id")}
                className={`message ${m.sender_type}${forUser ? " reply-to-user" : isGroup && m.sender_type === "agent" ? " ai-collaboration" : ""}`}
              >
                <div className="message-meta">
                  <strong>
                    {m.sender_type === "human"
                      ? "你"
                      : str(m, "sender_name") || str(m, "agent_name")}
                  </strong>
                  {isGroup && (
                    <span
                      className={`group-recipient${forUser ? " user-reply-label" : ""}`}
                    >
                      {forUser
                        ? "回复你"
                        : (
                            ((m.group as RecordData | null)
                              ?.recipients as RecordData[]) ?? []
                          )
                            .filter((r) => r.mentioned)
                            .map((r) => `@${r.name}`)
                            .join(" ") ||
                          (m.sender_type === "human" ? "发给总控" : "AI 协作")}
                    </span>
                  )}
                  <small>{date(m.created_at)}</small>
                </div>
                {isGroup && !!(m.group as RecordData | null)?.reply_to_id && (
                  <div className="group-reply-reference">
                    回复{" "}
                    {(() => {
                      const ref = w.messages.find(
                        (r) => r.id === (m.group as RecordData).reply_to_id,
                      );
                      return ref
                        ? `${ref.sender_type === "human" ? "你" : str(ref, "sender_name") || str(ref, "agent_name")}：${messageDisplay(ref).slice(0, 90)}`
                        : "此前消息";
                    })()}
                  </div>
                )}
                {m.quote_id ? (
                  <blockquote>
                    <ChatMarkdown
                      text={messageDisplay(
                        w.messages.find((x) => x.id === m.quote_id) ?? {},
                      )}
                    />
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
                        content: messageDisplay(m),
                      })
                    }
                  >
                    记录为重点
                  </button>
                </div>
              </article>
            );
          })
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
            if (unavailableMention) return;
            if (
              await ai.send(
                draft,
                files,
                quoteId,
                undefined,
                selectedMentions.map((m) => str(m, "id")),
              )
            ) {
              setDraft("");
              setFiles([]);
              setAttachmentsOpen(false);
              setMentions([]);
              setMentionOpen(false);
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
          {mentionOpen && (
            <MentionPicker
              members={members.filter(
                (m) => m.id !== session.id && m.membership_status === "active",
              )}
              onClose={() => setMentionOpen(false)}
              onSelect={(m) => {
                setMentions((old) =>
                  old.some((r) => r.id === m.id) ? old : [...old, m],
                );
                setDraft(
                  (old) => `${old.replace(/@$/, "")}@${str(m, "name")} `,
                );
                setMentionOpen(false);
              }}
            />
          )}
          {mentions.some((m) => draft.includes(`@${str(m, "name")}`)) && (
            <div className="mention-recipients">
              <small>同时发给总控与</small>
              {mentions
                .filter((m) => draft.includes(`@${str(m, "name")}`))
                .map((m) => (
                  <button
                    type="button"
                    key={str(m, "id")}
                    onClick={() => {
                      setMentions((old) => old.filter((r) => r.id !== m.id));
                      setDraft((old) =>
                        old.replaceAll(`@${str(m, "name")}`, ""),
                      );
                    }}
                  >
                    @{str(m, "name")} ×
                  </button>
                ))}
            </div>
          )}
          <textarea
            aria-label="给总控的消息"
            placeholder="说说你的想法，或 @ 在场 AI；不 @ 默认发给总控…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.endsWith("@")) setMentionOpen(true);
            }}
            disabled={ai.sending}
          />
          {unavailableMention && (
            <p className="error" role="alert">
              提及的 AI 已退出，请移除提及，并告诉总控你想继续与它讨论。
            </p>
          )}
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
              onClick={() => setMentionOpen(!mentionOpen)}
            >
              ＠ 提及
            </button>
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
                unavailableMention ||
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
          这是子 AI 的会话记录。可在总控讨论群中 @ 此 AI 或引用消息。
        </div>
      )}
    </section>
  );
}
