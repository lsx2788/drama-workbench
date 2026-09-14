"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Clapperboard,
  LayoutDashboard,
  GitBranch,
  Boxes,
  MessagesSquare,
  FileText,
  Activity,
  Plus,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";
import { api, str, type Workspace, type RecordData } from "@/client/api";
import { Empty } from "./ui";
import { CreateForm, type FormKind } from "./create-form";
import { FlowView } from "./flow-view";
import { AssetView } from "./asset-view";
import { DiscussionView } from "./discussion-view";

import { OverviewView } from "./overview-view";
import { DocumentsView } from "./documents-view";
import { RunsView } from "./runs-view";

const tabs = [
  { id: "overview", label: "项目总览", icon: LayoutDashboard },
  { id: "flow", label: "流程与事项", icon: GitBranch },
  { id: "assets", label: "资产库", icon: Boxes },
  { id: "chat", label: "沟通中心", icon: MessagesSquare },
  { id: "documents", label: "故事与文稿", icon: FileText },
  { id: "runs", label: "执行记录", icon: Activity },
];
export function Workbench() {
  const [projects, setProjects] = useState<RecordData[]>([]),
    [p, setP] = useState(""),
    [w, setW] = useState<Workspace>(),
    [tab, setTab] = useState("overview"),
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
  const refresh = useCallback(async () => {
    if (p) setW(await api<Workspace>(`/projects/${p}/workspace`));
  }, [p]);
  useEffect(() => {
    setW(undefined);
    if (p) refresh().catch(fail);
  }, [p, refresh]);
  const create = (kind: FormKind, defaults?: Record<string, string>) =>
    setForm({ kind, defaults });
  const project = projects.find((row) => row.id === p);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Clapperboard size={23} />
          </span>
          <div>
            映序<small>DRAMA WORKBENCH</small>
          </div>
        </a>
        <div className="workspace-label">
          制作空间 <span>LOCAL</span>
        </div>
        <select
          aria-label="切换项目"
          className="project-switch"
          value={p}
          onChange={(e) => setP(e.target.value)}
        >
          {!projects.length && <option value="">尚未创建项目</option>}
          {projects.map((row) => (
            <option value={str(row, "id")} key={str(row, "id")}>
              {str(row, "name")}
            </option>
          ))}
        </select>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={18} />
              {t.label}
              {tab === t.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
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
            } else await refresh();
          }}
        />
      )}
    </div>
  );
}
