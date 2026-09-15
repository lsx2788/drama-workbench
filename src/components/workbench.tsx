"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Clapperboard, FolderOpen, Plus, X } from "lucide-react";
import { api, str, type Workspace, type RecordData } from "@/client/api";
import {
  pageTitles,
  tabReducer,
  type WorkspacePage as Page,
  type ProjectView,
} from "@/client/workspace-tabs";
import { ProjectTree } from "./project-tree";
import { WorkspaceTabs } from "./workspace-tabs";
import { WorkspacePage } from "./workspace-page";
import { CreateForm, type FormKind } from "./create-form";
import { Empty } from "./ui";
import type { StoryDiscussion } from "@/shared/story-import";

export function Workbench() {
  const [projects, setProjects] = useState<RecordData[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>({});
  const [tabs, dispatch] = useReducer(tabReducer, { pages: [], activeId: "" });
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<{
    kind: FormKind;
    projectId: string;
    defaults?: Record<string, string>;
  } | null>(null);
  const requests = useRef(new Map<string, Promise<void>>());
  const active = tabs.pages.find((page) => page.id === tabs.activeId);
  const p = active?.projectId ?? selectedProject;
  const project = projects.find((row) => row.id === p);
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : "操作失败"),
    [],
  );
  const open = useCallback((page: Omit<Page, "id">) => {
    dispatch({ type: "open", page });
    setSelectedProject(page.projectId);
    setDirectoryOpen(false);
    setNotice("");
  }, []);
  const navigate = useCallback(
    (projectId: string, kind: ProjectView) => {
      open({ projectId, kind, title: pageTitles[kind] });
    },
    [open],
  );
  const loadProjects = useCallback(async () => {
    const rows = await api<RecordData[]>("/projects");
    setProjects(rows);
    return rows;
  }, []);
  const refresh = useCallback((projectId: string) => {
    const request = api<Workspace>(`/projects/${projectId}/workspace`)
      .then((data) => {
        if (requests.current.get(projectId) === request)
          setWorkspaces((previous) => ({ ...previous, [projectId]: data }));
      })
      .finally(() => {
        if (requests.current.get(projectId) === request)
          requests.current.delete(projectId);
      });
    requests.current.set(projectId, request);
    return request;
  }, []);
  useEffect(() => {
    let current = true;
    loadProjects()
      .then((rows) => {
        if (current && rows[0]) navigate(str(rows[0], "id"), "coordinator");
      })
      .catch(fail)
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [loadProjects, navigate, fail]);
  useEffect(() => {
    for (const page of tabs.pages) {
      if (!workspaces[page.projectId] && !requests.current.has(page.projectId))
        refresh(page.projectId).catch(fail);
    }
  }, [tabs.pages, workspaces, refresh, fail]);
  useEffect(() => {
    if (!directoryOpen) return;
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDirectoryOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [directoryOpen]);
  const create = (
    kind: FormKind,
    projectId = p,
    defaults?: Record<string, string>,
  ) => setForm({ kind, projectId, defaults });
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
          view={
            active?.kind === "assets" || active?.kind === "flow"
              ? active.kind
              : "coordinator"
          }
          onProject={setSelectedProject}
          onNavigate={navigate}
        />
        <button className="new-project" onClick={() => create("project")}>
          <Plus size={16} /> 创建项目
        </button>
      </aside>
      <main className="workspace-main">
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
        <WorkspaceTabs
          pages={tabs.pages}
          activeId={tabs.activeId}
          projects={projects}
          onSelect={(id) => {
            setNotice("");
            dispatch({ type: "select", id });
          }}
          onClose={(id) => dispatch({ type: "close", id })}
        />
        {error && (
          <div role="alert" className="error-banner workspace-notice">
            <span>{error}</span>
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {notice && (
          <div className="story-save-notice workspace-notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice("")}>关闭</button>
          </div>
        )}
        <div className="workspace-panels">
          {loading ? (
            <Empty>正在读取项目…</Empty>
          ) : !projects.length ? (
            <section className="welcome content">
              <h1>从一个故事开始。</h1>
              <p>保存故事，与总控一起确定制作方向。</p>
              <button className="primary" onClick={() => create("project")}>
                创建第一个项目
              </button>
            </section>
          ) : null}
          {tabs.pages.map((page) => (
            <section
              key={page.id}
              className="workspace-panel content"
              role="tabpanel"
              id={`page-${page.id}`}
              aria-labelledby={`tab-${page.id}`}
              hidden={page.id !== tabs.activeId}
            >
              {workspaces[page.projectId] ? (
                <WorkspacePage
                  page={page}
                  w={workspaces[page.projectId]}
                  create={(kind, defaults) =>
                    create(kind, page.projectId, defaults)
                  }
                  refresh={() => refresh(page.projectId)}
                  fail={fail}
                  open={open}
                  clearQuote={() =>
                    dispatch({ type: "clearQuote", id: page.id })
                  }
                />
              ) : (
                <Empty>正在读取故事资料…</Empty>
              )}
            </section>
          ))}
        </div>
      </main>
      {form && (
        <CreateForm
          kind={form.kind}
          defaults={form.defaults}
          workspace={workspaces[form.projectId]}
          projectId={form.projectId}
          onClose={() => setForm(null)}
          onSaved={async (result) => {
            const saved = result as RecordData;
            const projectId =
              form.kind === "project" ? str(saved, "id") : form.projectId;
            if (form.kind === "project") await loadProjects();
            await refresh(projectId);
            if (form.kind === "project" || form.kind === "story") {
              const discussion = saved.discussion as StoryDiscussion;
              open({
                projectId,
                kind: "coordinator",
                title: "总控聊天",
                targetId: discussion.sessionId,
              });
              setNotice("故事已保存，选择和想法已写入总控聊天。");
            } else if (form.kind === "session") {
              open({
                projectId,
                kind: "chat",
                targetId: str(saved, "id"),
                title: str(saved, "title"),
              });
            }
            setForm(null);
          }}
        />
      )}
    </div>
  );
}
