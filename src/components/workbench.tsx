"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  Clapperboard,
  GitBranch,
  Boxes,
  MessagesSquare,
  Plus,
  ArrowUpRight,
  ChevronRight,
  FolderOpen,
  X,
} from "lucide-react";
import { api, str, type Workspace, type RecordData } from "@/client/api";
import { Empty } from "./ui";
import { ProjectTree, type NavigationTarget } from "./project-tree";
import { CreateForm, type FormKind } from "./create-form";
import { FlowView } from "./flow-view";
import { AssetView } from "./asset-view";
import { DiscussionView } from "./discussion-view";

import { OverviewView } from "./overview-view";
import { DocumentsView } from "./documents-view";
import { RunsView } from "./runs-view";

export function Workbench() {
  const [projects, setProjects] = useState<RecordData[]>([]),
    [p, setP] = useState(""),
    [w, setW] = useState<Workspace>(),
    [tab, setTab] = useState("overview"),
    [selectedNodeId, setSelectedNodeId] = useState(""),
    [selectedWorkflowId, setSelectedWorkflowId] = useState(""),
    [directoryOpen, setDirectoryOpen] = useState(false),
    [navigationScroll, setNavigationScroll] = useState<"node" | "chat" | null>(
      null,
    ),
    [chat, setChat] = useState({ sessionId: "", quoteId: "" }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [form, setForm] = useState<{
      kind: FormKind;
      defaults?: Record<string, string>;
    } | null>(null);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "操作失败");
  const loadProjects = useCallback(async () => {
    const rows = await api<RecordData[]>("/projects");
    setProjects(rows);
    setP((previous) =>
      rows.some((r) => r.id === previous)
        ? previous
        : String(rows[0]?.id ?? ""),
    );
  }, []);
  useEffect(() => {
    loadProjects()
      .catch(fail)
      .finally(() => setLoading(false));
  }, [loadProjects]);
  const activeProject = useRef(p);
  activeProject.current = p;
  const refresh = useCallback(async () => {
    if (!p) return;
    const data = await api<Workspace>(`/projects/${p}/workspace`);
    if (activeProject.current === p) setW(data);
  }, [p]);
  useEffect(() => {
    setW(undefined);
    setSelectedNodeId("");
    setSelectedWorkflowId("");
    setForm(null);
    setError("");
    setChat({ sessionId: "", quoteId: "" });
    if (p) refresh().catch(fail);
  }, [p, refresh]);
  useEffect(() => {
    if (!directoryOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDirectoryOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [directoryOpen]);
  const create = (kind: FormKind, defaults?: Record<string, string>) =>
    setForm({ kind, defaults });
  useEffect(() => {
    if (!navigationScroll || directoryOpen || !w) return;
    const target = document.querySelector(
      navigationScroll === "chat" ? ".chat-panel" : ".node-detail",
    );
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    setNavigationScroll(null);
  }, [navigationScroll, directoryOpen, w]);
  const project = projects.find((row) => row.id === p);
  function navigate(target: NavigationTarget, keepDirectoryOpen = false) {
    setTab(target.view);
    setSelectedWorkflowId(target.workflowId ?? "");
    setSelectedNodeId(target.nodeId ?? "");
    setChat({ sessionId: target.sessionId ?? "", quoteId: "" });
    // Expanding a folder keeps the mobile directory open; selecting a leaf closes it.
    if (!keepDirectoryOpen) setDirectoryOpen(false);
    if (!keepDirectoryOpen && target.nodeId)
      setNavigationScroll(target.sessionId ? "chat" : "node");
  }
  const chatActions = {
    sessionId: chat.sessionId,
    quoteId: chat.quoteId,
    onSelect: (sessionId: string) => setChat({ sessionId, quoteId: "" }),
    onClearQuote: () => setChat((previous) => ({ ...previous, quoteId: "" })),
    onQuote: (quoteId: string) => {
      const coordinator =
        w?.sessions.find(
          (s) => s.id === chat.sessionId && s.node_type === "coordinator",
        ) ?? w?.sessions.find((s) => s.node_type === "coordinator");
      if (!coordinator) {
        fail(new Error("请先在总控节点建立聊天"));
        return;
      }
      setChat({ sessionId: str(coordinator, "id"), quoteId });
      setTab("chat");
    },
  };
  return (
    <div className="app-shell">
      {directoryOpen && (
        <button
          className="directory-backdrop"
          aria-label="关闭项目目录"
          onClick={() => setDirectoryOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${directoryOpen ? "directory-open" : ""}`}
        id="project-directory"
      >
        <button
          className="directory-close"
          aria-label="收起项目目录"
          onClick={() => setDirectoryOpen(false)}
        >
          <X size={18} />
        </button>
        <a className="brand" href="/">
          <span className="brand-icon">
            <Clapperboard size={23} />
          </span>
          <div>
            映序<small>DRAMA WORKBENCH</small>
          </div>
        </a>
        <div className="workspace-label">项目文件夹</div>
        <ProjectTree
          projects={projects}
          projectId={p}
          workspace={w}
          current={{
            view: tab,
            workflowId: selectedWorkflowId,
            nodeId: selectedNodeId,
            sessionId: chat.sessionId,
          }}
          onProject={(id) => {
            setP(id);
            setTab("overview");
            setSelectedNodeId("");
            setSelectedWorkflowId("");
            setChat({ sessionId: "", quoteId: "" });
          }}
          onNavigate={navigate}
        />
        <button className="new-project" onClick={() => create("project")}>
          <Plus size={16} /> 创建新项目
        </button>
        <div className="sidebar-bottom">
          <span className="status-dot" /> 核心底座 · 本地运行
          <small>让讨论有依据，让成果有归处。</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="directory-toggle"
            aria-expanded={directoryOpen}
            aria-controls="project-directory"
            onClick={() => setDirectoryOpen(!directoryOpen)}
          >
            <FolderOpen size={17} /> 项目目录
          </button>
          <div>
            工作空间 <ChevronRight size={14} />
            <strong>{(project?.name as string) || "开始你的第一个项目"}</strong>
          </div>
          <span className="version-chip">FOUNDATION / 0.1</span>
        </header>
        <div className="content">
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {loading ? (
            <Empty>正在读取项目…</Empty>
          ) : !p ? (
            <section className="welcome">
              <span className="eyebrow">FROM AN IDEA TO A WORLD</span>
              <h1>
                把故事的每一步，
                <br />
                变成可以接续的创作。
              </h1>
              <p>
                在这里整理故事、定义流程，与 AI 围绕节点协作。
                <br />
                每份定稿真实保存，每个关键决定都能回溯。
              </p>
              <button className="primary" onClick={() => create("project")}>
                创建第一个项目 <ArrowUpRight size={18} />
              </button>
              <div className="welcome-features">
                <div>
                  <GitBranch />
                  <strong>流程因故事而定</strong>
                  <small>先讨论，再形成适合项目的路线。</small>
                </div>
                <div>
                  <Boxes />
                  <strong>成果进入资产库</strong>
                  <small>形态、组合与版本都有明确记录。</small>
                </div>
                <div>
                  <MessagesSquare />
                  <strong>重点不留在记忆里</strong>
                  <small>节点结论与会话历史独立保存。</small>
                </div>
              </div>
            </section>
          ) : !w ? (
            <Empty>正在整理项目数据…</Empty>
          ) : (
            <>
              {tab === "overview" && (
                <OverviewView
                  w={w}
                  project={project}
                  create={create}
                  setTab={setTab}
                />
              )}
              {tab === "flow" && (
                <FlowView
                  {...chatActions}
                  selectedWorkflowId={selectedWorkflowId}
                  onSelectWorkflow={setSelectedWorkflowId}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    if (nodeId)
                      setSelectedWorkflowId(
                        str(
                          w.nodes.find((n) => n.id === nodeId) ?? {},
                          "workflow_id",
                        ),
                      );
                    setChat({ sessionId: "", quoteId: "" });
                  }}
                  w={w}
                  p={p}
                  create={create}
                  refresh={refresh}
                  fail={fail}
                />
              )}
              {tab === "assets" && (
                <AssetView
                  w={w}
                  p={p}
                  create={() => create("asset")}
                  refresh={refresh}
                  fail={fail}
                />
              )}
              {tab === "chat" && (
                <DiscussionView
                  {...chatActions}
                  w={w}
                  p={p}
                  create={create}
                  refresh={refresh}
                  fail={fail}
                />
              )}
              {tab === "documents" && <DocumentsView w={w} create={create} />}
              {tab === "runs" && (
                <RunsView w={w} p={p} refresh={refresh} fail={fail} />
              )}
            </>
          )}
        </div>
        <footer>
          映序 · 核心底座 <span>项目状态由独立数据聚合 · 素材保存在本地</span>
        </footer>
      </main>
      {form && (
        <CreateForm
          key={form.kind}
          kind={form.kind}
          defaults={form.defaults}
          workspace={w}
          projectId={p}
          onClose={() => setForm(null)}
          onSaved={async (result) => {
            setForm(null);
            if (form.kind === "project") {
              await loadProjects();
              setP(str(result as RecordData, "id"));
            } else {
              await refresh();
              if (form.kind === "session") {
                const session = result as RecordData;
                setChat({ sessionId: str(session, "id"), quoteId: "" });
                if (form.defaults?.nodeId) {
                  setSelectedNodeId(form.defaults.nodeId);
                  setTab("flow");
                } else setTab("chat");
              }
            }
          }}
        />
      )}
    </div>
  );
}
