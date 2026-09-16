"use client";
import { useRef, useState } from "react";
import { mentionAt, selectedMentionIds } from "@/client/chat-mentions";
import { str, type Workspace, type RecordData } from "@/client/api";
import { Badge, Empty, date } from "./ui";
import type { CreateAction } from "./view-types";
import { StoryPreview } from "./story-preview";
import { MessageBubble } from "./message-bubble";
import { AiConnectionSettings } from "./ai-connection-settings";
import { useAiChat } from "./use-ai-chat";
import { StoryFileUpload } from "./story-file-upload";
import { ChatImages } from "./chat-images";
import { GroupMembers, MentionPicker } from "./group-chat-controls";
import { ChatMarkdown } from "./chat-markdown";
import { WorkflowOutlinePreview } from "./workflow-outline-preview";

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
      <ChatMarkdown
        text={messageDisplay(message)}
        mentionedNames={(
          ((message.group as RecordData | null)?.recipients as RecordData[]) ??
          []
        )
          .filter((r) => r.mentioned)
          .map((r) => str(r, "name"))}
      />
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
  refresh,
  fail,
  onQuote,
  onClearQuote,
  onOutlineOpen,
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
  onOutlineOpen?: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [fileError, setFileError] = useState("");
  const [mentions, setMentions] = useState<RecordData[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionRange, setMentionRange] =
    useState<ReturnType<typeof mentionAt>>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const updateMention = (value: string, caret: number) => {
    const range = mentionAt(
      value,
      caret,
      mentions.map((m) => str(m, "name")),
    );
    setMentionRange(range);
    setMentionOpen(!!range);
  };
  const ai = useAiChat(p, str(session, "id"), refresh, fail);
  const busy = ai.sending || ai.running;
  const isGroup = session.node_type === "coordinator";
  const members = (w.groupCandidates ?? []).filter(
    (m) => m.group_id === session.id,
  );
  const mentionIds = selectedMentionIds(
    draft,
    mentions.map((m) => ({ id: str(m, "id"), name: str(m, "name") })),
  );
  const selectedMentions = mentions.filter((m) =>
    mentionIds.includes(str(m, "id")),
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
          <Badge value={String(session?.status)} />
        </div>
      </div>
      <GroupMembers
        members={
          isGroup
            ? members
            : [
                {
                  ...session,
                  name: session.agent_name,
                  membership_status: "active",
                },
              ]
        }
        agents={w.agents}
        p={p}
        refresh={refresh}
        connection={ai.settings}
      />
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
              <MessageBubble
                key={str(m, "id")}
                className={`message ${m.sender_type}${forUser ? " reply-to-user" : isGroup && m.sender_type === "agent" ? " ai-collaboration" : ""}`}
                sender={
                  m.sender_type === "human"
                    ? "你"
                    : str(m, "sender_name") || str(m, "agent_name")
                }
                onQuote={() => {
                  onQuote(str(m, "id"));
                  requestAnimationFrame(() => composerInput.current?.focus());
                }}
              >
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
                    <ChatMarkdown
                      text={messageDisplay(
                        w.messages.find((x) => x.id === m.quote_id) ?? {},
                      )}
                    />
                  </blockquote>
                ) : null}
                <StoryMessage p={p} message={m} stories={w.stories} />
                <ChatImages images={m.images} />
                {(w.workflowOutlines ?? [])
                  .filter((o) => o.message_id === m.id)
                  .map((o) => (
                    <WorkflowOutlinePreview
                      key={str(o, "id")}
                      outline={o}
                      onOpen={onOutlineOpen}
                    />
                  ))}
              </MessageBubble>
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
            if (await ai.send(draft, files, quoteId, undefined, mentionIds)) {
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
          {mentionOpen && mentionRange && (
            <MentionPicker
              members={members.filter(
                (m) =>
                  m.id !== session.id &&
                  m.membership_status === "active" &&
                  str(m, "name")
                    .toLowerCase()
                    .includes(mentionRange.query.toLowerCase()),
              )}
              onClose={() => setMentionOpen(false)}
              onSelect={(m) => {
                setMentions((old) =>
                  old.some((r) => r.id === m.id) ? old : [...old, m],
                );
                const insertion = `@${str(m, "name")} `;
                const caret = mentionRange.start + insertion.length;
                setDraft(
                  (old) =>
                    old.slice(0, mentionRange.start) +
                    insertion +
                    old.slice(mentionRange.end),
                );
                setMentionOpen(false);
                setMentionRange(null);
                requestAnimationFrame(() => {
                  composerInput.current?.focus();
                  composerInput.current?.setSelectionRange(caret, caret);
                });
              }}
            />
          )}
          <textarea
            ref={composerInput}
            aria-label="给总控的消息"
            placeholder="说说你的想法，输入 @ 选择成员…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              updateMention(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) =>
              updateMention(
                e.currentTarget.value,
                e.currentTarget.selectionStart,
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Escape") setMentionOpen(false);
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
