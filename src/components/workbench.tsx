"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, FolderOpen, Plus, X } from "lucide-react";
import { api, str, type Workspace, type RecordData } from "@/client/api";
import { ProjectTree, type ProjectView } from "./project-tree";
import { FlowView } from "./flow-view";
import { StoryLibrary } from "./story-library";
import { CreateForm, type FormKind } from "./create-form";
import { Empty } from "./ui";
import type { StoryDiscussion } from "@/shared/story-import";
export function Workbench() {
  const [projects, setProjects] = useState<RecordData[]>([]),
    [p, setP] = useState(""),
    [w, setW] = useState<Workspace>(),
    [view, setView] = useState<ProjectView>("flow"),
    [nodeId, setNodeId] = useState(""),
    [chat, setChat] = useState({ sessionId: "", quoteId: "" }),
    [directoryOpen, setDirectoryOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<{
    kind: FormKind;
    defaults?: Record<string, string>;
  } | null>(null);
  const activeProject = useRef(p);
  const pendingDiscussion = useRef<
    (StoryDiscussion & { projectId: string }) | null
  >(null);
  activeProject.current = p;
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "操作失败");
  const loadProjects = useCallback(async () => {
    const rows = await api<RecordData[]>("/projects");
    setProjects(rows);
    setP((previous) =>
      rows.some((r) => r.id === previous) ? previous : str(rows[0] ?? {}, "id"),
    );
  }, []);
  const refresh = useCallback(async () => {
    if (!p) return;
    const data = await api<Workspace>(`/projects/${p}/workspace`);
    if (activeProject.current === p) setW(data);
  }, [p]);
  useEffect(() => {
    const pending = pendingDiscussion.current;
    if (!pending || w?.overview.project.id !== pending.projectId) return;
    pendingDiscussion.current = null;
    setView("flow");
    setNodeId(pending.nodeId);
    setChat({ sessionId: pending.sessionId, quoteId: "" });
  }, [w]);
  useEffect(() => {
    loadProjects()
      .catch(fail)
      .finally(() => setLoading(false));
  }, [loadProjects]);
  useEffect(() => {
    setW(undefined);
    setNodeId("");
    setChat({ sessionId: "", quoteId: "" });
    setForm(null);
    setError("");
    setView("flow");
    refresh().catch(fail);
  }, [refresh]);
  useEffect(() => {
    if (!directoryOpen) return;
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDirectoryOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [directoryOpen]);
  const create = (kind: FormKind, defaults?: Record<string, string>) =>
    setForm({ kind, defaults });
  const project = projects.find((r) => r.id === p);
  const chatActions = {
    sessionId: chat.sessionId,
    quoteId: chat.quoteId,
    onSelect: (sessionId: string) => setChat({ sessionId, quoteId: "" }),
    onClearQuote: () => setChat((c) => ({ ...c, quoteId: "" })),
    onQuote: (quoteId: string) => {
      const workflow =
        w?.overview.workflow ?? w?.workflows.find((f) => f.status === "draft");
      const coordinator = w?.sessions.find(
        (s) =>
          s.node_type === "coordinator" &&
          w.nodes.some(
            (n) => n.id === s.node_id && n.workflow_id === workflow?.id,
          ),
      );
      if (!coordinator) {
        fail(new Error("总控聊天尚未就绪"));
        return;
      }
      setNodeId(str(coordinator, "node_id"));
      setChat({ sessionId: str(coordinator, "id"), quoteId });
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
        <div className="workspace-label">项目</div>
        <ProjectTree
          projects={projects}
          projectId={p}
          view={view}
          onProject={(id) => {
            setP(id);
            setView("flow");
            setNodeId("");
          }}
          onNavigate={(next) => {
            setView(next);
            setNodeId("");
            setDirectoryOpen(false);
          }}
        />
        <button className="new-project" onClick={() => create("project")}>
          <Plus size={16} /> 创建项目
        </button>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="directory-toggle"
            aria-controls="project-directory"
            aria-expanded={directoryOpen}
            onClick={() => setDirectoryOpen(!directoryOpen)}
          >
            <FolderOpen size={17} /> 项目目录
          </button>
          <div>
            <strong>{project ? str(project, "name") : "我的项目"}</strong>
          </div>
        </header>
        <div className="content">
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {notice && (
            <div className="story-save-notice" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>关闭</button>
            </div>
          )}
          {loading ? (
            <Empty>正在读取项目…</Empty>
          ) : !p ? (
            <section className="welcome">
              <h1>从一个故事开始。</h1>
              <p>项目里只有制作流程和故事资产库。</p>
              <button className="primary" onClick={() => create("project")}>
                创建第一个项目
              </button>
            </section>
          ) : !w || w.overview.project.id !== p ? (
            <Empty>正在读取故事资料…</Empty>
          ) : view === "flow" ? (
            <FlowView
              key={p}
              {...chatActions}
              selectedNodeId={nodeId}
              onSelectNode={(id) => {
                setNodeId(id);
                setChat({ sessionId: "", quoteId: "" });
              }}
              w={w}
              p={p}
              create={create}
              refresh={refresh}
              fail={fail}
            />
          ) : (
            <StoryLibrary
              key={p}
              w={w}
              p={p}
              onImport={() => create("story")}
            />
          )}
        </div>
      </main>
      {form && (
        <CreateForm
          kind={form.kind}
          defaults={form.defaults}
          workspace={w}
          projectId={p}
          onClose={() => setForm(null)}
          onSaved={async (result) => {
            const saved = result as RecordData;
            if (form.kind === "project" || form.kind === "story") {
              pendingDiscussion.current = {
                ...(saved.discussion as StoryDiscussion),
                projectId: form.kind === "project" ? str(saved, "id") : p,
              };
            }
            if (form.kind === "project") {
              await loadProjects();
              setP(str(saved, "id"));
              setDirectoryOpen(false);
              setNotice("故事、风格意向和想法已保存，已准备好总控讨论。");
            } else {
              await refresh();
              if (form.kind === "story")
                setNotice("故事、风格意向和想法已保存，已准备好总控讨论。");
              if (form.kind === "session") {
                setNodeId(
                  form.defaults?.nodeId ??
                    str(
                      w?.agents.find((a) => a.id === saved.agent_id) ?? {},
                      "node_id",
                    ),
                );
                setChat({ sessionId: str(saved, "id"), quoteId: "" });
              }
            }
            setForm(null);
          }}
        />
      )}
    </div>
  );
}
