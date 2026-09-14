"use client";
import { str } from "@/client/api";
import { Panel, Badge, date } from "./ui";
import { ChatPanel } from "./chat-panel";
import type { ChatViewProps } from "./view-types";

export function NodeChats({
  nodeId,
  ...props
}: ChatViewProps & { nodeId: string }) {
  const { w, create, sessionId, onSelect } = props;
  const agents = w.agents.filter((a) => a.node_id === nodeId);
  const sessions = w.sessions.filter((s) => s.node_id === nodeId);
  const active = sessions.find((s) => s.id === sessionId);
  return (
    <Panel
      title={`节点聊天 · ${sessions.length}`}
      action={
        <button
          onClick={() =>
            agents.length
              ? create("session", { nodeId, agentId: str(agents[0], "id") })
              : create("agent", { nodeId })
          }
        >
          {agents.length ? "＋ 添加聊天" : "＋ 先添加节点 AI"}
        </button>
      }
    >
      <p className="muted">
        围绕不同主题建立聊天。点开即可查看记录，关键结论留在节点重点中。
      </p>
      <div className="node-chat-list">
        {sessions.map((s) => {
          const messages = w.messages.filter((m) => m.session_id === s.id);
          const last = messages.at(-1);
          return (
            <button
              key={str(s, "id")}
              className={`node-chat-card ${active?.id === s.id ? "selected" : ""}`}
              aria-pressed={active?.id === s.id}
              onClick={() => onSelect(str(s, "id"))}
            >
              <span className="avatar">
                {s.node_type === "coordinator" ? "总" : "AI"}
              </span>
              <span className="node-chat-copy">
                <strong>{str(s, "title")}</strong>
                <small>
                  {str(s, "agent_name")} · {messages.length} 条消息 ·{" "}
                  {date(last?.created_at ?? s.created_at)}
                </small>
                <span>
                  {last ? str(last, "content") : "还没有消息，点击查看聊天"}
                </span>
              </span>
              <Badge value={str(s, "status")} />
            </button>
          );
        })}
      </div>
      {!sessions.length && (
        <p className="muted">
          这个节点还没有聊天。
          {agents.length
            ? "可为本节点的 AI 添加一个讨论主题。"
            : "先确定参与这个节点的 AI，再建立聊天。"}
        </p>
      )}
      {active && (
        <div className="node-chat-open">
          <div className="node-chat-toolbar">
            <span>当前聊天</span>
            <button onClick={() => onSelect("")}>收起聊天</button>
          </div>
          <ChatPanel key={str(active, "id")} {...props} session={active} />
        </div>
      )}
    </Panel>
  );
}
