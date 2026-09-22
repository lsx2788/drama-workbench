import type { Message } from "@/domain/types";
import { MessageBody } from "./message-body";
import { TaskReferences } from "./task-references";

export function ChatActivity({
  messages,
  mentionNames,
  onTask,
}: {
  messages: Message[];
  mentionNames: string[];
  onTask: (id: string) => void;
}) {
  const pending = messages.some(
    (m) => m.questionTransfer?.status === "pending",
  );
  return (
    <details className="studio-chat-activity">
      <summary>
        <span>
          协作过程 <small>{messages.length} 条</small>
        </span>
        <span>{pending ? "内部问题待总控处理" : "展开查看"}</span>
      </summary>
      <div className="studio-chat-activity-records">
        {messages.map((message) => (
          <section key={message.id} id={`chat-message-${message.id}`}>
            <header>
              <strong>{message.sender}</strong>
              <time>
                {new Date(message.time).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </header>
            {message.questionTransfer && (
              <p className="studio-question-route">
                {message.questionTransfer.status === "pending"
                  ? "接收者：总控 AI · 无需用户直接回复"
                  : "总控已答复"}
              </p>
            )}
            <MessageBody
              text={message.text}
              mentionNames={mentionNames}
              needsReply={false}
              isLatestReply={false}
            />
            {!!message.references?.length && (
              <TaskReferences references={message.references} />
            )}
            {message.taskId && (
              <button
                className="studio-message-link"
                onClick={() => onTask(message.taskId!)}
              >
                查看相关产出
              </button>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
