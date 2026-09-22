"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Folder,
  ListTree,
  PanelRightClose,
  Quote,
  Sparkles,
  Paperclip,
  Video,
} from "lucide-react";
import { ExportFiles } from "@/shared/ui/export-files";
import { ChatImages, ChatImageDrafts } from "./chat-images";
import { MessageBody } from "./message-body";
import {
  discussionMessages,
  discussionTimeline,
  isProcessMessage,
  messageReplyBody,
} from "./message-presentation";
import { ChatActivity } from "./chat-activity";
import { taskOutputState } from "@/domain/output-status";
import { ReferenceGroups } from "./reference-groups";
import { StudioDialog } from "@/shared/ui/dialog";
import { SkipConfirmationDialog } from "./confirmations";
import { AgentSettings } from "./agent-settings";
import { ExecutionBadge, ExecutionPanel } from "./execution-status";
import { MessageImage } from "./message-image";
import { TaskReferences } from "./task-references";
import type { PromptApi } from "@/domain/agent-config";
import {
  executorNames,
  nextRecommendation,
  taskDisplayTitle,
  type StudioProject,
  type Message,
  type MediaFile,
} from "@/domain";

export function StudioChat({
  project,
  exportFiles = [],
  active,
  busy,
  onMessage,
  onSkip,
  onTask,
  onFlow,
  onPublish,
  promptApi,
  replyRequest,
  onReplyHandled,
}: {
  project: StudioProject;
  exportFiles?: MediaFile[];
  active: boolean;
  busy: boolean;
  onMessage: (
    text: string,
    replyToId?: string,
    imageRevision?: number,
    images?: File[],
  ) => Promise<boolean>;
  onSkip: (messageId: string) => Promise<boolean>;
  onTask: (id: string) => void;
  onFlow: () => void;
  onPublish: () => void;
  promptApi: PromptApi;
  replyRequest: { messageId: string; sequence: number } | null;
  onReplyHandled: () => void;
}) {
  const [text, setText] = useState(""),
    [quote, setQuote] = useState<Message | null>(null),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      message: Message;
    } | null>(null);
  const [references, setReferences] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [members, setMembers] = useState(false);
  const [skipTarget, setSkipTarget] = useState<Message | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<File[]>([]),
    [imageError, setImageError] = useState("");
  function addImages(next: File[]) {
    if (busy || !next.length) return;
    if (
      next.some(
        (file) => !/\.(png|jpe?g|webp|gif|txt|md|docx|pdf)$/i.test(file.name),
      )
    ) {
      setImageError("支持图片及 TXT、MD、DOCX、PDF 文件");
      return;
    }
    const combined = [...images, ...next];
    if (combined.length > 5) {
      setImageError("一次最多上传5份附件");
      return;
    }
    if (
      combined.some(
        (file) =>
          !file.size ||
          file.size >
            (/\.(png|jpe?g|webp|gif)$/i.test(file.name) ? 10 : 20) *
              1024 *
              1024,
      ) ||
      combined.reduce((n, file) => n + file.size, 0) > 30 * 1024 * 1024
    ) {
      setImageError(
        "图片不超过10MB，文档不超过20MB，合计不超过30MB；不能上传空文件",
      );
      return;
    }
    setImages(combined);
    setImageError("");
  }
  useEffect(() => {
    // Leaving a preserved chat tab must not carry its editing focus into the next visit.
    if (!active) input.current?.blur();
  }, [active]);
  useEffect(() => {
    const resizeInput = () => {
      if (!input.current) return;
      input.current.style.height = "";
      if (window.matchMedia("(max-width: 700px)").matches) {
        input.current.style.height = "44px";
        input.current.style.height = `${Math.min(112, Math.max(44, input.current.scrollHeight + 2))}px`;
      }
    };
    resizeInput();
    window.addEventListener("resize", resizeInput);
    return () => window.removeEventListener("resize", resizeInput);
  }, [text, active]);
  const mentionNames = [
    ...Object.values(executorNames),
    "总控 AI",
    "独立审核 AI",
    "原作理解 AI",
    "你",
    "用户",
    ...project.messages.map((m) => m.sender),
  ];
  function reply(message: Message) {
    setQuote(message);
    input.current?.focus({ preventScroll: true });
  }
  const list = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null);
  const next = nextRecommendation(project);
  const messages = discussionMessages(project.messages);
  const entries = discussionTimeline(project.messages);
  const followBottom = useRef(true);
  const [unread, setUnread] = useState(false);
  // Task status cards and user messages do not replace the latest AI reply.
  const latestReplyId = messages.findLast(
    (message) =>
      message.sender !== "你" &&
      message.sender !== "系统" &&
      !isProcessMessage(message) &&
      !message.questionTransfer &&
      !message.execution,
  )?.id;
  const approved = Object.values(project.tasks).filter(
    (t) => t.text && t.delivery === "approved",
  );
  const drafts = Object.values(project.tasks).filter(
    (t) => t.text && taskOutputState(t) === "draft",
  );
  const paused = Object.values(project.tasks).filter(
    (t) => t.text && taskOutputState(t) === "paused",
  );
  useEffect(() => {
    if (
      quote?.confirmation?.status === "pending" &&
      project.messages.find((m) => m.id === quote.id)?.confirmation?.status ===
        "skipped"
    )
      setQuote(null);
  }, [project.messages, quote]);
  useEffect(() => {
    if (!active || !list.current) return;
    if (followBottom.current)
      list.current.scrollTop = list.current.scrollHeight;
    else setUnread(true);
  }, [project.messages.length, active]);
  useEffect(() => {
    if (!active || !replyRequest) return;
    const message = project.messages.find(
      (m) => m.id === replyRequest.messageId,
    );
    if (!message) return;
    // Run after the dialog closes and the chat's normal bottom-scroll effect.
    const frame = requestAnimationFrame(() => {
      setQuote(message);
      input.current?.focus({ preventScroll: true });
      document
        .getElementById(`chat-message-${message.id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      onReplyHandled();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, replyRequest, project.messages, onReplyHandled]);
  async function send() {
    if (
      busy ||
      (["running", "queued"].includes(project.run?.status ?? "") &&
        quote?.image?.status !== "completed")
    )
      return;
    if (
      (text.trim() || images.length) &&
      (await onMessage(
        `${quote ? `> ${quote.text.replaceAll("\n", "\n> ")}\n\n` : ""}${text.trim()}`,
        quote?.id,
        quote?.image?.revision,
        images,
      ))
    ) {
      setText("");
      setQuote(null);
      setImages([]);
      setImageError("");
      followBottom.current = true;
      setUnread(false);
      requestAnimationFrame(() => {
        if (list.current) list.current.scrollTop = list.current.scrollHeight;
      });
    }
  }
  return (
    <div
      className={`studio-chat-layout ${collapsed ? "references-hidden" : ""}`}
    >
      <div className="studio-chat-main">
        <header className="studio-chat-header">
          <div>
            <strong>总控讨论</strong>
            <small>制作方向 · 任务协调 · 成果验收</small>
          </div>
          <div className="studio-chat-header-actions">
            <button onClick={() => setMembers(true)}>成员</button>
          </div>
          <button
            className="studio-mobile-reference"
            aria-label="查看制作流程"
            onClick={onFlow}
          >
            <ListTree size={16} />
          </button>
          <button
            className="studio-mobile-reference"
            aria-label="查看资料与工作状态"
            onClick={() => setReferences(true)}
          >
            <Folder size={16} />
          </button>
        </header>
        <div
          className="studio-chat-notice"
          role="status"
          data-active={
            !!project.run?.error ||
            ["running", "queued"].includes(project.run?.status ?? "")
          }
        >
          {project.run?.status === "running" || project.run?.status === "queued"
            ? "总控正在处理，结果会自动更新…"
            : project.run?.error || "本机 Codex · 消息与产出自动保存"}
        </div>
        <div
          className="studio-chat-messages"
          ref={list}
          onScroll={() => {
            const element = list.current;
            if (!element) return;
            followBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80;
            if (followBottom.current) setUnread(false);
          }}
        >
          {entries.map((entry) => {
            if (entry.kind === "activity")
              return (
                <ChatActivity
                  key={entry.id}
                  messages={entry.messages}
                  mentionNames={mentionNames}
                  onTask={onTask}
                />
              );
            const m = entry.message;
            const body = messageReplyBody(m, project.messages);
            return (
              <article
                key={m.id}
                id={`chat-message-${m.id}`}
                className={`studio-message ${m.sender === "你" ? "human" : "agent"} ${m.sender !== "你" && (m.audience === "human" || (!m.audience && m.sender === "总控 AI" && !/^\s*@/.test(m.text))) ? "for-user" : ""} ${m.confirmation?.status === "pending" ? "needs-reply" : ""}`}
                tabIndex={m.confirmation?.status === "pending" ? 0 : undefined}
                onClick={(event) => {
                  if (
                    m.confirmation?.status === "pending" &&
                    !(event.target as HTMLElement).closest(
                      "button,a,input,summary",
                    )
                  )
                    reply(m);
                }}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    m.confirmation?.status === "pending" &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    reply(m);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({
                    x: Math.min(e.clientX, window.innerWidth - 160),
                    y: Math.min(e.clientY, window.innerHeight - 120),
                    message: m,
                  });
                }}
              >
                <header>
                  <strong>{m.sender}</strong>
                  {m.execution && <ExecutionBadge execution={m.execution} />}
                  {m.confirmation && (
                    <span
                      className={`studio-confirmation-tag ${m.confirmation.status}`}
                    >
                      {m.confirmation.status === "pending"
                        ? "待确认 · 点击回复"
                        : m.confirmation.status === "skipped"
                          ? "已跳过"
                          : "已回复"}
                    </span>
                  )}
                  {m.confirmation?.status === "pending" && (
                    <button
                      className="studio-skip-question"
                      disabled={busy}
                      onClick={() => setSkipTarget(m)}
                    >
                      跳过
                    </button>
                  )}
                  <time>
                    {new Date(m.time).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </header>
                {m.execution?.error && (
                  <p className="studio-run-error">{m.execution.error}</p>
                )}
                {m.questionTransfer && (
                  <p className="studio-question-route" role="status">
                    {m.questionTransfer.status === "answered"
                      ? "内部问题 · 总控已答复"
                      : "内部问题 → 总控 AI · 等待总控处理"}
                    <small>
                      无需直接回复此条；需要你决定时，总控会另行提问。
                    </small>
                  </p>
                )}
                {m.execution && !m.image ? (
                  <>
                    <p>
                      {m.taskId && project.tasks[m.taskId]
                        ? taskDisplayTitle(project.tasks[m.taskId])
                        : "节点任务"}
                    </p>
                    <details className="studio-message-quoted">
                      <summary>查看交接记录</summary>
                      <MessageBody
                        text={body.text}
                        mentionNames={mentionNames}
                        needsReply={false}
                        isLatestReply={false}
                      />
                    </details>
                  </>
                ) : (
                  <MessageBody
                    text={body.text}
                    mentionNames={mentionNames}
                    needsReply={m.confirmation?.status === "pending"}
                    isLatestReply={m.id === latestReplyId}
                  />
                )}
                {body.quote && (
                  <details className="studio-message-quoted">
                    <summary>引用 {body.quote.sender} 的消息</summary>
                    <MessageBody
                      text={body.quote.text}
                      mentionNames={mentionNames}
                      needsReply={false}
                      isLatestReply={false}
                    />
                  </details>
                )}
                {m.image && <MessageImage image={m.image} />}
                {m.image?.status === "completed" && (
                  <button
                    className="studio-message-link studio-image-feedback-action"
                    onClick={() => reply(m)}
                  >
                    <Quote size={13} />
                    引用图片提意见
                  </button>
                )}
                {m.references?.length ? (
                  <TaskReferences references={m.references} />
                ) : null}
                {!!m.attachments?.length && (
                  <ChatImages files={m.attachments} />
                )}
                {m.feedback && (
                  <p className="studio-feedback-state" role="status">
                    {m.feedback.status === "pending"
                      ? "意见已收到 · 待总控处理，相关图片暂缓验收"
                      : m.feedback.status === "revise"
                        ? "总控已处理 · 已退回修改"
                        : "总控已处理 · 保留当前版本"}
                  </p>
                )}
                {m.taskId && project.tasks[m.taskId] && (
                  <button
                    className="studio-message-link"
                    onClick={() => onTask(m.taskId!)}
                  >
                    查看相关产出
                    <ChevronRight size={12} />
                  </button>
                )}
              </article>
            );
          })}
          {!project.confirmed && project.plan && (
            <div className="studio-chat-welcome">
              <Sparkles size={21} />
              <strong>流程方案待确认</strong>
              <p>{project.plan.summary}</p>
              <button onClick={onPublish}>查看流程方案</button>
              <small>确认方案后，正式流程才会出现在流程图中。</small>
            </div>
          )}
          <div ref={end} />
        </div>
        {unread && (
          <button
            className="studio-chat-new-messages"
            onClick={() => {
              followBottom.current = true;
              setUnread(false);
              list.current?.scrollTo({
                top: list.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            有新消息 · 查看最新
          </button>
        )}
        <div
          className="studio-composer"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            addImages(Array.from(e.dataTransfer.files));
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addImages(files);
            }
          }}
        >
          {!!images.length && (
            <ChatImageDrafts
              files={images}
              onRemove={(index) => {
                setImages((items) => items.filter((_, i) => i !== index));
                setImageError("");
              }}
              disabled={busy}
            />
          )}
          {imageError && (
            <p className="studio-chat-image-error" role="alert">
              {imageError}
            </p>
          )}
          {quote && (
            <div className="studio-quote">
              <Quote size={12} />
              <span>{quote.text}</span>
              <button onClick={() => setQuote(null)}>取消</button>
            </div>
          )}
          {quote?.image?.status === "completed" && (
            <p className="studio-feedback-hint">
              可在审核期间发送指导意见，总控核对后转达制作 AI。
            </p>
          )}
          <div className="studio-composer-input">
            <input
              ref={picker}
              type="file"
              hidden
              accept=".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.docx,.pdf"
              multiple
              onChange={(e) => {
                addImages(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <textarea
              ref={input}
              aria-label="发送给总控的消息"
              disabled={busy}
              placeholder="说说你的想法…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !text && quote) {
                  e.preventDefault();
                  setQuote(null);
                }
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
            />
          </div>
          <div className="studio-composer-footer">
            <small>Enter 发送 · Shift + Enter 换行</small>
            <div className="studio-composer-actions">
              <button
                className="studio-chat-upload"
                type="button"
                aria-label="上传文件"
                title="添加图片或参考文件，也支持粘贴图片；最多5份附件"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                <Paperclip size={19} />
              </button>
              <button
                className="studio-primary"
                disabled={
                  busy ||
                  (["queued", "running"].includes(project.run?.status ?? "") &&
                    quote?.image?.status !== "completed") ||
                  (!text.trim() && !images.length)
                }
                onClick={send}
                aria-label="发送消息"
              >
                <ArrowUp size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <aside className="studio-chat-reference">
        <header>
          <span>
            <Folder size={15} />
            资料与资产
          </span>
          <button
            aria-label={collapsed ? "展开资料" : "收起资料"}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelRightClose size={15} />
          </button>
        </header>
        {!collapsed && (
          <>
            <ExecutionPanel project={project} onTask={onTask} />
            {exportFiles.length > 0 && (
              <button
                className="studio-reference-folder"
                onClick={() => setExportsOpen(true)}
              >
                <Video size={23} />
                <span>
                  视频与导出
                  <small>{exportFiles.length} 个文件 · 播放与下载</small>
                </span>
                <ChevronRight size={13} />
              </button>
            )}
            <button
              className="studio-reference-folder"
              onClick={() => setReferences(true)}
            >
              <Folder size={23} />
              <span>
                已确认<small>{approved.length} 项</small>
              </span>
              <ChevronRight size={13} />
            </button>
            {!!drafts.length && (
              <button
                className="studio-reference-folder"
                onClick={() => setReferences(true)}
              >
                <Folder size={23} />
                <span>
                  讨论中<small>{drafts.length} 项</small>
                </span>
                <ChevronRight size={13} />
              </button>
            )}
            <button className="studio-reference-folder" onClick={onFlow}>
              <ListTree size={22} />
              <span>
                制作流程
                <small>
                  {project.confirmed
                    ? `${project.episodes.filter((e) => !project.tasks[`episode-${e.number}`]?.placeholder).length} 集`
                    : "尚未确认"}
                </small>
              </span>
              <ChevronRight size={13} />
            </button>
            {next && (
              <div className="studio-next">
                <small>建议下一步</small>
                <strong>{taskDisplayTitle(next)}</strong>
                <button onClick={() => onTask(next.id)}>
                  查看任务
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </aside>
      {menu && (
        <>
          <button
            className="studio-menu-dismiss"
            aria-label="关闭消息菜单"
            onClick={() => setMenu(null)}
          />
          <div
            className="studio-context-menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              onClick={() => {
                reply(menu.message);
                setMenu(null);
              }}
            >
              引用消息
            </button>
            {menu.message.confirmation?.status === "pending" && (
              <button
                disabled={busy}
                onClick={() => {
                  setSkipTarget(menu.message);
                  setMenu(null);
                }}
              >
                跳过问题
              </button>
            )}
          </div>
        </>
      )}
      {skipTarget && (
        <SkipConfirmationDialog
          message={skipTarget}
          busy={busy}
          onClose={() => setSkipTarget(null)}
          onConfirm={async () => {
            if (await onSkip(skipTarget.id)) {
              if (quote?.id === skipTarget.id) setQuote(null);
              setSkipTarget(null);
            }
          }}
        />
      )}
      {references && (
        <StudioDialog
          title="资料与工作状态"
          onClose={() => setReferences(false)}
        >
          {exportFiles.length > 0 && (
            <button
              className="studio-reference-folder"
              onClick={() => {
                setReferences(false);
                setExportsOpen(true);
              }}
            >
              <Video size={23} />
              <span>
                视频与导出
                <small>{exportFiles.length} 个文件 · 播放与下载</small>
              </span>
              <ChevronRight size={13} />
            </button>
          )}
          <ExecutionPanel
            project={project}
            onTask={(id) => {
              setReferences(false);
              onTask(id);
            }}
          />
          {[
            { title: "已确认", tasks: approved },
            { title: "讨论中", tasks: drafts },
            { title: "已暂停", tasks: paused },
          ]
            .filter((group) => group.tasks.length || group.title === "已确认")
            .map((group) => (
              <ReferenceGroups
                key={group.title}
                {...group}
                onTask={(id) => {
                  setReferences(false);
                  onTask(id);
                }}
              />
            ))}
        </StudioDialog>
      )}
      {members && (
        <AgentSettings
          project={project}
          promptApi={promptApi}
          onClose={() => setMembers(false)}
        />
      )}
      {exportsOpen && (
        <StudioDialog
          title="视频与导出"
          onClose={() => setExportsOpen(false)}
          wide
        >
          <ExportFiles files={exportFiles} />
        </StudioDialog>
      )}
    </div>
  );
}
