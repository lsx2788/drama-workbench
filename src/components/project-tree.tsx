"use client";
import { useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  GitBranch,
  Database,
} from "lucide-react";
import { str, type RecordData } from "@/client/api";
export type ProjectView = "flow" | "assets";
export function ProjectTree({
  projects,
  projectId,
  view,
  onProject,
  onNavigate,
}: {
  projects: RecordData[];
  projectId: string;
  view: ProjectView;
  onProject: (id: string) => void;
  onNavigate: (view: ProjectView) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <nav className="project-tree" aria-label="项目目录">
      <ul className="tree-root">
        {projects.map((project) => {
          const id = str(project, "id"),
            open = expanded === id && projectId === id;
          return (
            <li key={id}>
              <button
                className={`tree-row tree-project ${id === projectId ? "current-project" : ""}`}
                aria-expanded={open}
                title={str(project, "name")}
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
              {open && (
                <ul className="tree-children">
                  {(
                    [
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
                        onClick={() => onNavigate(item.key)}
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
          <li className="tree-empty">创建项目后，从这里进入。</li>
        )}
      </ul>
    </nav>
  );
}
