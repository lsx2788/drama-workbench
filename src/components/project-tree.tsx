"use client";
import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  MessageSquare,
  Boxes,
  Activity,
  GitBranch,
} from "lucide-react";
import { str, type Workspace, type RecordData } from "@/client/api";

export interface NavigationTarget {
  view: string;
  workflowId?: string;
  nodeId?: string;
  sessionId?: string;
}
interface TreeProps {
  projects: RecordData[];
  projectId: string;
  workspace?: Workspace;
  current: NavigationTarget;
  onProject: (id: string) => void;
  onNavigate: (target: NavigationTarget, keepDirectoryOpen?: boolean) => void;
}

function FolderBranch({
  label,
  children,
  onOpen,
  selected = false,
}: {
  label: string;
  children: ReactNode;
  onOpen?: () => void;
  selected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        className={`tree-row tree-folder ${selected ? "selected" : ""}`}
        title={label}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) onOpen?.();
        }}
      >
        <ChevronRight
          size={13}
          className={open ? "tree-chevron open" : "tree-chevron"}
        />
        {open ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span>{label}</span>
      </button>
      {open && <ul className="tree-children">{children}</ul>}
    </li>
  );
}

function TreeLeaf({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        title={label}
        className={`tree-row tree-leaf ${selected ? "selected" : ""}`}
        aria-current={selected ? "page" : undefined}
        onClick={onClick}
      >
        {icon}
        <span>{label}</span>
      </button>
    </li>
  );
}

function ProjectContents({
  workspace: w,
  current,
  onNavigate,
}: Pick<TreeProps, "workspace" | "current" | "onNavigate">) {
  if (!w) return <li className="tree-empty">正在读取项目…</li>;
  return (
    <>
      <FolderBranch label="制作流程">
        <TreeLeaf
          label="查看流程图"
          icon={<GitBranch size={15} />}
          selected={current.view === "flow" && !current.nodeId}
          onClick={() => onNavigate({ view: "flow" })}
        />
        {w.workflows.map((f) => (
          <FolderBranch
            key={str(f, "id")}
            label={str(f, "name")}
            onOpen={() =>
              onNavigate({ view: "flow", workflowId: str(f, "id") }, true)
            }
            selected={current.view === "flow" && current.workflowId === f.id}
          >
            {w.nodes
              .filter((n) => n.workflow_id === f.id)
              .map((n) => (
                <FolderBranch
                  key={str(n, "id")}
                  label={str(n, "name")}
                  selected={current.view === "flow" && current.nodeId === n.id}
                  onOpen={() =>
                    onNavigate(
                      {
                        view: "flow",
                        workflowId: str(f, "id"),
                        nodeId: str(n, "id"),
                      },
                      true,
                    )
                  }
                >
                  <TreeLeaf
                    label="节点信息"
                    icon={<FileText size={15} />}
                    selected={
                      current.view === "flow" &&
                      current.nodeId === n.id &&
                      !current.sessionId
                    }
                    onClick={() =>
                      onNavigate({
                        view: "flow",
                        workflowId: str(f, "id"),
                        nodeId: str(n, "id"),
                      })
                    }
                  />
                  {w.sessions
                    .filter((s) => s.node_id === n.id)
                    .map((s) => (
                      <TreeLeaf
                        key={str(s, "id")}
                        label={str(s, "title")}
                        icon={<MessageSquare size={15} />}
                        selected={current.sessionId === s.id}
                        onClick={() =>
                          onNavigate({
                            view: "flow",
                            workflowId: str(f, "id"),
                            nodeId: str(n, "id"),
                            sessionId: str(s, "id"),
                          })
                        }
                      />
                    ))}
                  {!w.sessions.some((s) => s.node_id === n.id) && (
                    <li className="tree-empty">暂无聊天</li>
                  )}
                </FolderBranch>
              ))}
            {!w.nodes.some((n) => n.workflow_id === f.id) && (
              <li className="tree-empty">暂无节点</li>
            )}
          </FolderBranch>
        ))}
        {!w.workflows.length && <li className="tree-empty">暂无流程</li>}
      </FolderBranch>
      <FolderBranch label="创作资料">
        <TreeLeaf
          label="故事与文稿"
          icon={<FileText size={15} />}
          selected={current.view === "documents"}
          onClick={() => onNavigate({ view: "documents" })}
        />
        <TreeLeaf
          label="资产库"
          icon={<Boxes size={15} />}
          selected={current.view === "assets"}
          onClick={() => onNavigate({ view: "assets" })}
        />
      </FolderBranch>
      <FolderBranch label="项目记录">
        <TreeLeaf
          label="全部聊天"
          icon={<MessageSquare size={15} />}
          selected={current.view === "chat"}
          onClick={() => onNavigate({ view: "chat" })}
        />
        <TreeLeaf
          label="执行记录"
          icon={<Activity size={15} />}
          selected={current.view === "runs"}
          onClick={() => onNavigate({ view: "runs" })}
        />
      </FolderBranch>
    </>
  );
}

export function ProjectTree({
  projects,
  projectId,
  workspace,
  current,
  onProject,
  onNavigate,
}: TreeProps) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  return (
    <nav className="project-tree" aria-label="项目目录">
      <ul className="tree-root">
        {projects.map((project) => {
          const id = str(project, "id"),
            open = expandedProject === id;
          return (
            <li key={id}>
              <button
                className={`tree-row tree-project ${id === projectId ? "current-project" : ""}`}
                title={str(project, "name")}
                aria-expanded={open}
                onClick={() => {
                  setExpandedProject(open ? null : id);
                  if (!open) onProject(id);
                }}
              >
                <ChevronRight
                  size={13}
                  className={open ? "tree-chevron open" : "tree-chevron"}
                />
                {open ? <FolderOpen size={18} /> : <Folder size={18} />}
                <span>{str(project, "name")}</span>
              </button>
              {open && (
                <ul className="tree-children">
                  <ProjectContents
                    key={id}
                    workspace={id === projectId ? workspace : undefined}
                    current={current}
                    onNavigate={onNavigate}
                  />
                </ul>
              )}
            </li>
          );
        })}
        {!projects.length && (
          <li className="tree-empty">创建项目后，从这里展开内容。</li>
        )}
      </ul>
    </nav>
  );
}
