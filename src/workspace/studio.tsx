"use client";
import { useState } from "react";
import { useMobileViewport } from "@/shared/hooks/use-mobile-viewport";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Folder,
  GitBranch,
  Menu,
  MessageCircle,
  Plus,
  X,
} from "lucide-react";
import { emptyProject } from "@/domain/structure";
import { useStudio } from "@/application/use-studio";
import { StudioDialog } from "@/shared/ui/dialog";
import { ProductionMap } from "@/features/workflow/flow";
import { TaskDialog } from "@/features/tasks/task-dialog";
import { AssetLibrary } from "@/features/assets/library";
import { ResourceExport } from "@/features/assets/resource-export";
import { downloadResourcePackage } from "@/application/resource-export";
import { StudioChat } from "@/features/discussion/chat";
import { ConfirmationInbox } from "@/features/discussion/confirmations";
import { promptApi } from "@/application/prompt-api";
import { Intake } from "@/features/intake/intake";
import { nextRecommendation, type TaskAction } from "@/domain";
import "./studio.css";

type Page = "flow" | "chat" | "assets";
const pages = [
  { id: "chat" as const, label: "总控讨论", icon: MessageCircle },
  { id: "flow" as const, label: "制作流程", icon: GitBranch },
  { id: "assets" as const, label: "资产库", icon: Folder },
];
export function Studio() {
  const viewportRoot = useMobileViewport();
  const store = useStudio();
  const { state, files, loaded, saving, error, setError, select } = store;
  const [page, setPage] = useState<Page>("chat"),
    [tabs, setTabs] = useState<Page[]>(["chat"]),
    [directory, setDirectory] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [archive, setArchive] = useState(false),
    [intake, setIntake] = useState(false),
    [about, setAbout] = useState(false);
  const [home, setHome] = useState(true),
    [flowDialog, setFlowDialog] = useState(false);
  const [resourceExport, setResourceExport] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(["qinghe"]),
    [publish, setPublish] = useState(false);
  const [replyRequest, setReplyRequest] = useState<{
    projectId: string;
    messageId: string;
    sequence: number;
  } | null>(null);
  const project =
    state.projects.find((p) => p.id === state.activeId) ?? emptyProject();
  const open = (next: Page) => {
    setHome(false);
    setPage(next);
    setTabs((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setDirectory(false);
  };
  const task = selected ? project.tasks[selected] : undefined;
  const recommendation = nextRecommendation(project);
  async function action(id: string, value: TaskAction) {
    const reason = ["review", "accept"].includes(value.type)
      ? window.prompt("请简要记录人工审核依据")
      : "";
    if (reason === null) return false;
    return store.act(project, id, value, reason);
  }
  async function create(name: string, message: string, sourceFiles: File[]) {
    const ok = await store.create(name, message, sourceFiles);
    if (ok) open("chat");
    return ok;
  }
  return (
    <div className="studio-shell" ref={viewportRoot}>
      {directory && (
        <button
          className="studio-directory-shade"
          aria-label="关闭剧本目录"
          onClick={() => setDirectory(false)}
        />
      )}
      <aside className={`studio-sidebar ${directory ? "open" : ""}`}>
        <a className="studio-brand" href="/">
          <span>
            <Clapperboard size={23} />
          </span>
          <div>
            映序<small>DRAMA WORKBENCH</small>
          </div>
        </a>
        <div className="studio-directory-label">
          剧本
          <button onClick={() => setIntake(true)} aria-label="创建剧本">
            <Plus size={15} />
          </button>
        </div>
        <div className="studio-project-tree">
          {state.projects.map((p) => (
            <div key={p.id}>
              <button
                className="studio-project-button"
                onClick={async () => {
                  if (p.id !== project.id) {
                    select(p.id);
                    setSelected(null);
                  }
                  setExpanded((prev) =>
                    prev.includes(p.id)
                      ? prev.filter((id) => id !== p.id)
                      : [...prev, p.id],
                  );
                }}
              >
                {expanded.includes(p.id) ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
                <BookOpen size={17} />
                <strong>{p.name}</strong>
              </button>
              {expanded.includes(p.id) && (
                <div className="studio-project-pages">
                  {pages.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      className={
                        p.id === project.id && page === id ? "active" : ""
                      }
                      onClick={async () => {
                        if (p.id !== project.id) select(p.id);
                        setSelected(null);
                        open(id);
                      }}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          className="studio-new"
          disabled={!loaded}
          onClick={() => setIntake(true)}
        >
          <Plus size={16} />
          新建剧本
        </button>
        <footer>
          <button onClick={() => setAbout(true)}>
            <i />
            工作台信息
          </button>
          <small>独立存储 · 本机 Codex</small>
        </footer>
      </aside>
      <main className={`studio-main ${loaded && !home && project.id && page === "chat" ? "chat-active" : ""}`}>
        <div className="studio-topbar">
          <button
            className="studio-directory-toggle"
            aria-label="打开剧本目录"
            onClick={() => setDirectory(true)}
          >
            <Menu size={18} />
          </button>
          <span className="studio-topbar-title">
            {home ? "新建剧本" : project.name}
          </span>
          {loaded && (
            <ConfirmationInbox
              projects={state.projects}
              busy={saving}
              onSkip={store.skipConfirmation}
              onOpen={(projectId, messageId) => {
                select(projectId);
                setSelected(null);
                setFlowDialog(false);
                setPublish(false);
                setExpanded((prev) =>
                  prev.includes(projectId) ? prev : [...prev, projectId],
                );
                setReplyRequest((prev) => ({
                  projectId,
                  messageId,
                  sequence: (prev?.sequence ?? 0) + 1,
                }));
                open("chat");
              }}
            />
          )}
          <span className="studio-topbar-right">
            <i />
            {saving ? "正在保存" : "已保存到本机服务"}
            <button onClick={() => setAbout(true)}>工作台</button>
          </span>
        </div>
        {loaded && !home && project.id && (
          <nav className="studio-workspace-tabs" aria-label="内部页面">
            {tabs.map((id) => {
              const entry = pages.find((p) => p.id === id)!;
              const Icon = entry.icon;
              return (
                <div className={page === id ? "active" : ""} key={id}>
                  <button onClick={() => open(id)}>
                    <Icon size={15} />
                    {entry.label}
                  </button>
                  {tabs.length > 1 && (
                    <button
                      aria-label={`关闭${entry.label}`}
                      onClick={() => {
                        const next = tabs.filter((p) => p !== id);
                        setTabs(next);
                        if (page === id) setPage(next[next.length - 1]);
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </nav>
        )}
        {!loaded ? (
          <div className="studio-empty">{error || "正在打开工作台…"}</div>
        ) : home || !project.id ? (
          <div className="studio-empty studio-home">
            <h2>从一个故事开始</h2>
            <p>上传原文，与总控一起确定制作方向。</p>
            <button className="studio-primary" onClick={() => setIntake(true)}>
              新建剧本
            </button>
          </div>
        ) : (
          <div className="studio-workspace" key={project.id}>
            <header className="studio-page-heading">
              <div>
                <span className="studio-eyebrow">
                  {page === "flow"
                    ? "PRODUCTION FLOW"
                    : page === "assets"
                      ? "STORY ASSETS"
                      : "COORDINATOR"}
                </span>
                <h1>{pages.find((p) => p.id === page)?.label}</h1>
              </div>
              {page === "flow" && recommendation && project.confirmed && (
                <button
                  className="studio-recommend"
                  onClick={() => setSelected(recommendation.id)}
                >
                  <span>建议下一步</span>
                  {recommendation.episode
                    ? `第 ${recommendation.episode} 集 · `
                    : ""}
                  {recommendation.title}
                  <ChevronRight size={14} />
                </button>
              )}
            </header>
            <div hidden={page !== "flow"}>
              <ProductionMap
                project={project}
                onTask={setSelected}
                onArchive={() => setArchive(true)}
                onExport={() => setResourceExport(true)}
              />
            </div>
            <div hidden={page !== "chat"}>
              <StudioChat
                promptApi={promptApi}
                project={project}
                exportFiles={files[`${project.id}/exports`] ?? []}
                active={page === "chat"}
                busy={saving}
                onTask={setSelected}
                onFlow={() => setFlowDialog(true)}
                onPublish={() => setPublish(true)}
                onSkip={(id) => store.skipConfirmation(project.id, id)}
                replyRequest={
                  replyRequest?.projectId === project.id ? replyRequest : null
                }
                onReplyHandled={() => setReplyRequest(null)}
                onMessage={(text, replyToId, imageRevision, images) =>
                  store.message(project.id, text, replyToId, imageRevision, images)
                }
              />
            </div>
            <div hidden={page !== "assets"}>
              <AssetLibrary
                onExport={() => setResourceExport(true)}
                project={project}
                files={files}
                onTask={setSelected}
                onRecycle={(fileId, action, reason) => store.recycleImage(project.id, fileId, action, reason)}
                onOrganize={() => store.message(project.id, "请整理当前剧本的旧图片：使用 image_inventory 分页查询图片记录，按当前提示词和实际用途检查旧图，先看实际图片与使用位置。仍可用或仍有参考价值的保留；不符合当前要求且不再需要的，用 recycle_image 移入可恢复的垃圾篓并写明具体原因。正在使用的保留并说明，不能仅凭生成时间或规则版本批量移入。同时检查 project 中已暂停且未验收的独立资产：查看退回原因、实际图片及引用，确认不再需要后调用 recycle_paused_asset(action=trash) 收起任务并移入垃圾篓。不得为清理先验收，不处理仍在执行或已验收的任务。不要为整理而生成新图，完成后按保留、已清理、仍在使用三类简要汇报。")}
              />
            </div>
          </div>
        )}
      </main>
      {error && loaded && (
        <div className="studio-toast" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {flowDialog && (
        <StudioDialog
          title="制作流程"
          className="studio-flow-dialog"
          wide
          onClose={() => setFlowDialog(false)}
        >
          <ProductionMap
            project={project}
            onTask={setSelected}
            onArchive={() => setArchive(true)}
            onExport={() => setResourceExport(true)}
          />
        </StudioDialog>
      )}
      {resourceExport && <ResourceExport key={project.id} project={project} files={files} onClose={() => setResourceExport(false)} onDownload={(ids, version) => downloadResourcePackage(project.id, ids, version)} />}
      {task && (
        <TaskDialog
          project={project}
          task={task}
          files={files}
          busy={saving}
          error={error}
          onClose={() => {
            setSelected(null);
            setError("");
          }}
          onSelect={(id) => {
            setSelected(id);
            setError("");
          }}
          onAction={action}
          onFiles={(id, f) => store.upload(project, id, f)}
        />
      )}
      {archive && (
        <StudioDialog title="归档" onClose={() => setArchive(false)}>
          <div className="studio-archive-placeholder" />
        </StudioDialog>
      )}
      {loaded && intake && (
        <Intake
          busy={saving}
          onClose={() => setIntake(false)}
          onCreate={create}
        />
      )}
      {about && (
        <StudioDialog title="工作台" onClose={() => setAbout(false)}>
          <p>
            原文、任务产出、审核、聊天与 AI
            会话记录保存在本机服务。手机和电脑访问同一服务即可同步。
          </p>
          <p>
            文字工作通过本机 Codex
            执行。图片、镜头视频与整集视频当前由人工上传；上传后仍需审核验收。
          </p>
          <p>
            新工程使用独立数据库，没有导入旧版数据。正式结果以节点的验收状态为准。
          </p>
        </StudioDialog>
      )}
      {publish && (
        <StudioDialog title="确认制作流程" onClose={() => setPublish(false)}>
          <p>
            {project.plan?.summary ??
              "总控尚未提出流程方案，请先在聊天中讨论。"}
          </p>
          {project.plan && (
            <>
              <p>先确认制作骨架，分集与镜头将随审核通过的产出逐步展开。</p>
              <button
                className="studio-primary"
                disabled={saving || project.confirmed}
                onClick={async () => {
                  if (await store.confirm(project.id, project.plan!.id)) {
                    setPublish(false);
                    open("flow");
                  }
                }}
              >
                确认此方案
              </button>
            </>
          )}
        </StudioDialog>
      )}
    </div>
  );
}
