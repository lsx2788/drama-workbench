"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  GitBranch,
  Database,
  MessageCircle,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { str, type RecordData } from "@/client/api";
import type { ProjectView } from "@/client/workspace-tabs";
export function ProjectTree({
  projects,
  projectId,
  view,
  onProject,
  onNavigate,
  onDelete,
}: {
  projects: RecordData[];
  projectId: string;
  view: ProjectView;
  onProject: (id: string) => void;
  onNavigate: (projectId: string, view: ProjectView) => void;
  onDelete: (project: RecordData) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    project: RecordData;
    x: number;
    y: number;
  } | null>(null);
  const showMenu = (project: RecordData, x: number, y: number) =>
    setMenu({
      project,
      x: Math.max(8, Math.min(x, window.innerWidth - 180)),
      y: Math.max(8, Math.min(y, window.innerHeight - 65)),
    });
  return (
    <nav className="project-tree" aria-label="剧本目录">
      <ul className="tree-root">
        {projects.map((project) => {
          const id = str(project, "id"),
            open = expanded === id;
          return (
            <li key={id}>
              <div
                className="tree-project-line"
                onContextMenu={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  showMenu(
                    project,
                    e.clientX || rect.left + 24,
                    e.clientY || rect.bottom,
                  );
                }}
              >
                <button
                  className={`tree-row tree-project ${id === projectId ? "current-project" : ""}`}
                  aria-expanded={open}
                  title={str(project, "name")}
                  onKeyDown={(e) => {
                    if (
                      e.key === "ContextMenu" ||
                      (e.shiftKey && e.key === "F10")
                    ) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      showMenu(project, rect.left + 24, rect.bottom);
                    }
                  }}
                  onClick={() => {
                    setExpanded(open ? null : id);
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
                <button
                  className="tree-project-more"
                  aria-label={`更多操作：${str(project, "name")}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    showMenu(project, rect.left, rect.bottom);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
              {open && (
                <ul className="tree-children">
                  {(
                    [
                      {
                        key: "coordinator",
                        name: "总控聊天",
                        icon: MessageCircle,
                      },
                      { key: "flow", name: "制作流程", icon: GitBranch },
                      { key: "assets", name: "故事资产库", icon: Database },
                    ] as const
                  ).map((item) => (
                    <li key={item.key}>
                      <button
                        className={`tree-row tree-leaf ${id === projectId && view === item.key ? "selected" : ""}`}
                        aria-current={
                          id === projectId && view === item.key
                            ? "page"
                            : undefined
                        }
                        onClick={() => onNavigate(id, item.key)}
                      >
                        <item.icon size={16} />
                        <span>{item.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {!projects.length && (
          <li className="tree-empty">创建剧本后，从这里进入。</li>
        )}
      </ul>
      {menu &&
        createPortal(
          <div
            className="project-menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          >
            <div
              className="project-context-menu"
              role="menu"
              aria-label="剧本操作"
              style={{ left: menu.x, top: menu.y }}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Tab") {
                  e.stopPropagation();
                  setMenu(null);
                }
              }}
            >
              <button
                autoFocus
                role="menuitem"
                onClick={() => {
                  onDelete(menu.project);
                  setMenu(null);
                }}
              >
                <Trash2 size={15} /> 删除剧本
              </button>
            </div>
          </div>,
          document.body,
        )}
    </nav>
  );
}
