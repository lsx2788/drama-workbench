"use client";
import { useEffect, useRef } from "react";
import { Database, GitBranch, MessageCircle, FileText, X } from "lucide-react";
import type { WorkspacePage } from "@/client/workspace-tabs";
import { str, type RecordData } from "@/client/api";

export function WorkspaceTabs({
  pages,
  activeId,
  projects,
  onSelect,
  onClose,
}: {
  pages: WorkspacePage[];
  activeId: string;
  projects: RecordData[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);
  if (!pages.length) return null;
  return (
    <div
      className="workspace-tabs"
      role="tablist"
      aria-label="已打开的页面"
      ref={bar}
    >
      {pages.map((page, index) => {
        const Icon =
          page.kind === "flow"
            ? GitBranch
            : page.kind === "assets"
              ? Database
              : page.kind === "node" || page.kind === "story"
                ? FileText
                : MessageCircle;
        const projectName = str(
          projects.find((p) => p.id === page.projectId) ?? {},
          "name",
        );
        return (
          <div
            className={`workspace-tab ${page.id === activeId ? "active" : ""}`}
            key={page.id}
          >
            <button
              role="tab"
              id={`tab-${page.id}`}
              aria-controls={`page-${page.id}`}
              aria-selected={page.id === activeId}
              tabIndex={page.id === activeId ? 0 : -1}
              title={`${projectName} · ${page.title}`}
              onClick={() => onSelect(page.id)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % pages.length;
                else if (event.key === "ArrowLeft")
                  next = (index + pages.length - 1) % pages.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = pages.length - 1;
                else if (event.key === "Delete") {
                  event.preventDefault();
                  onClose(page.id);
                  return;
                } else return;
                event.preventDefault();
                onSelect(pages[next].id);
                document.getElementById(`tab-${pages[next].id}`)?.focus();
              }}
            >
              <Icon size={14} />
              <span>
                <strong>{page.title}</strong>
                <small>{projectName}</small>
              </span>
            </button>
            <button
              className="workspace-tab-close"
              aria-label={`关闭 ${projectName} · ${page.title}`}
              onClick={() => onClose(page.id)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
