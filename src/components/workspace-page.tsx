"use client";
import { useEffect, useState } from "react";
import { History, Plus, FileText } from "lucide-react";
import { str, type Workspace } from "@/client/api";
import { coordinatorSessions } from "@/client/coordinator-sessions";
import type { WorkspacePage as Page } from "@/client/workspace-tabs";
import type { ChatViewProps, CreateAction } from "./view-types";
import { FlowView } from "./flow-view";
import { StoryLibrary } from "./story-library";
import { NodeDetails } from "./node-details";
import { ChatPanel } from "./chat-panel";
import { Empty } from "./ui";
import { StoryReader } from "./story-reader";
import { ProjectReferencePanel } from "./project-reference-panel";
import { WorkflowOutlinePanel } from "./workflow-outline-panel";

export function WorkspacePage({
  page,
  w,
  create,
  refresh,
  fail,
  open,
  clearQuote,
}: {
  page: Page;
  w: Workspace;
  create: CreateAction;
  refresh: () => Promise<void>;
  fail: (error: unknown) => void;
  open: (page: Omit<Page, "id">) => void;
  clearQuote: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [view, setView] = useState<"chat" | "outline">(() =>
    !page.quoteId && w.workflowOutlines?.length ? "outline" : "chat",
  );
  useEffect(() => {
    if (page.quoteId) setView("chat");
  }, [page.quoteId]);
  const [outlineId, setOutlineId] = useState("");
  const p = page.projectId;
  const coordinators = coordinatorSessions(w);
  const session =
    page.kind === "coordinator"
      ? (coordinators.find((s) => s.id === page.targetId) ?? coordinators[0])
      : w.sessions.find((s) => s.id === page.targetId);
  function openNode(id: string) {
    const node = w.nodes.find((n) => n.id === id);
    if (node)
      open({
        projectId: p,
        kind: "node",
        targetId: id,
        title: str(node, "name"),
      });
  }
  function openChat(id: string) {
    const chat = w.sessions.find((s) => s.id === id);
    if (chat)
      open({
        projectId: p,
        kind: "chat",
        targetId: id,
        title: str(chat, "title"),
      });
  }
  const props: ChatViewProps = {
    w,
    p,
    create,
    refresh,
    fail,
    sessionId: "",
    quoteId: page.quoteId ?? "",
    onSelect: openChat,
    onClearQuote: clearQuote,
    onQuote: (quoteId) => {
      if (
        session?.node_type === "coordinator" &&
        (page.kind === "chat" || page.kind === "coordinator")
      ) {
        open({ ...page, quoteId });
      } else if (coordinators[0]) {
        open({ projectId: p, kind: "coordinator", title: "总控聊天", quoteId });
      } else fail(new Error("总控聊天尚未就绪"));
    },
  };
  if (page.kind === "flow") return <FlowView {...props} />;
  if (page.kind === "story")
    return <StoryReader p={p} storyId={page.targetId!} />;
  if (page.kind === "assets")
    return (
      <StoryLibrary
        w={w}
        p={p}
        onImport={() => create("story")}
        refresh={refresh}
      />
    );
  if (page.kind === "node") {
    const node = w.nodes.find((n) => n.id === page.targetId);
    return node ? (
      <NodeDetails {...props} current={node} />
    ) : (
      <Empty>节点资料暂不可用。</Empty>
    );
  }
  if (!session) return <Empty>总控聊天尚未就绪。</Empty>;
  return (
    <div
      className={`conversation-page${session.node_type === "coordinator" ? " coordinator-workspace" : ""}`}
    >
      <div className="conversation-toolbar">
        <h2>
          {page.kind === "coordinator"
            ? "总控聊天"
            : str(session, "agent_name")}
        </h2>
        <div>
          <button
            onClick={() => openNode(str(session, "node_id"))}
            title="查看资料"
          >
            <FileText size={15} />
            <span>资料</span>
          </button>
          {page.kind === "coordinator" && (
            <>
              <button
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                <History size={15} />
                <span>历史聊天</span>
              </button>
              <button
                onClick={() =>
                  create("session", {
                    nodeId: str(session, "node_id"),
                    agentId: str(session, "agent_id"),
                  })
                }
              >
                <Plus size={15} />
                <span>新聊天</span>
              </button>
            </>
          )}
        </div>
      </div>
      {historyOpen && page.kind === "coordinator" && (
        <div className="conversation-history" aria-label="总控历史聊天">
          {w.sessions
            .filter((s) => s.node_type === "coordinator")
            .map((s) => (
              <button
                key={str(s, "id")}
                onClick={() => {
                  openChat(str(s, "id"));
                  setHistoryOpen(false);
                }}
              >
                <strong>{str(s, "title")}</strong>
                <small>
                  {str(s, "agent_name")} ·{" "}
                  {w.messages.filter((m) => m.session_id === s.id).length}{" "}
                  条消息
                </small>
              </button>
            ))}
        </div>
      )}
      {session.node_type === "coordinator" ? (
        <div className="coordinator-workspace-grid">
          <div className="coordinator-main">
            <div
              className="coordinator-view-tabs"
              role="tablist"
              aria-label="讨论与流程"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === "chat"}
                onClick={() => setView("chat")}
              >
                聊天
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "outline"}
                onClick={() => setView("outline")}
              >
                流程大纲
                {(w.workflowOutlines?.length ?? 0) > 0 && <span>已有草案</span>}
              </button>
            </div>
            <div
              className="coordinator-primary-panel"
              role="tabpanel"
              aria-label="聊天"
              hidden={view !== "chat"}
            >
              <ChatPanel
                key={str(session, "id")}
                {...props}
                session={session}
                onOutlineOpen={(id) => {
                  setOutlineId(id);
                  setView("outline");
                }}
              />
            </div>
            <div
              className="coordinator-primary-panel"
              role="tabpanel"
              aria-label="流程大纲"
              hidden={view !== "outline"}
            >
              {view === "outline" && (
                <WorkflowOutlinePanel
                  outlines={w.workflowOutlines ?? []}
                  selectedId={outlineId}
                  onSelect={setOutlineId}
                />
              )}
            </div>
          </div>
          <ProjectReferencePanel w={w} p={p} />
        </div>
      ) : (
        <ChatPanel key={str(session, "id")} {...props} session={session} />
      )}
    </div>
  );
}
