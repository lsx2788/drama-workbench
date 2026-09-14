"use client";
import { str } from "@/client/api";
import { Empty } from "./ui";
import { ChatPanel } from "./chat-panel";
import { DiscussionNotes } from "./discussion-notes";
import type { ChatViewProps } from "./view-types";

export function DiscussionView(props: ChatViewProps) {
  const { w, create, sessionId, onSelect } = props;
  const session =
    w.sessions.find((s) => s.id === sessionId) ??
    w.sessions.find((s) => s.node_type === "coordinator") ??
    w.sessions[0];
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>沟通中心</h2>
          <p>汇总各节点的聊天，也可以从流程节点直接进入讨论。</p>
        </div>
        <button onClick={() => create("session")}>＋ 添加聊天</button>
      </div>
      {!session ? (
        <Empty>
          暂无聊天。总控协调节点是你的沟通入口，节点 AI 就绪后可展开讨论。
        </Empty>
      ) : (
        <div className="discussion-layout">
          <aside className="session-list">
            {w.nodes
              .filter((n) => w.sessions.some((s) => s.node_id === n.id))
              .map((n) => (
                <div key={str(n, "id")}>
                  <h3 className="session-group-title">{str(n, "name")}</h3>
                  {w.sessions
                    .filter((s) => s.node_id === n.id)
                    .map((s) => (
                      <button
                        key={str(s, "id")}
                        className={session.id === s.id ? "selected" : ""}
                        onClick={() => onSelect(str(s, "id"))}
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
                </div>
              ))}
          </aside>
          <ChatPanel key={str(session, "id")} {...props} session={session} />
          <DiscussionNotes
            w={w}
            nodeId={str(session, "node_id")}
            create={create}
          />
        </div>
      )}
    </>
  );
}
