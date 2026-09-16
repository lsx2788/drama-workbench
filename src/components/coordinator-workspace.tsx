"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Folder,
  GitBranch,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import type { Workspace } from "@/client/api";
import {
  groupProjectReferences,
  referenceCount,
} from "@/client/project-references";
import { ProjectReferencePanel } from "./project-reference-panel";
import { WorkflowOutlinePanel } from "./workflow-outline-panel";
import { PromptDialog } from "./prompt-dialog";

/** Side panes follow available workspace width; the conversation stays mounted. */
export function CoordinatorWorkspace({
  w,
  p,
  sessionId,
  children,
}: {
  w: Workspace;
  p: string;
  sessionId: string;
  children: (openOutline: (id: string) => void) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [dialog, setDialog] = useState<"outline" | "references" | null>(null);
  const [outlineId, setOutlineId] = useState("");
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      // Hidden internal tabs must not overwrite their last usable width.
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, []);
  const { confirmed, discussing, sources } = groupProjectReferences(
    w,
    sessionId,
  );
  const hasReferences =
    referenceCount(confirmed) + referenceCount(discussing) + sources.length > 0;
  const canDockLeft = width >= 1180;
  const canDockRight = width >= 920;
  const leftExpanded = canDockLeft && leftOpen && !!w.workflowOutlines?.length;
  const rightExpanded = canDockRight && rightOpen;
  const openOutline = (id: string) => {
    setOutlineId(id);
    if (canDockLeft) setLeftOpen(true);
    else setDialog("outline");
  };
  const outline = (compact = false) => (
    <WorkflowOutlinePanel
      outlines={w.workflowOutlines ?? []}
      selectedId={outlineId}
      onSelect={setOutlineId}
      compact={compact}
    />
  );
  return (
    <div ref={container} className="coordinator-studio">
      <aside
        className={`studio-side studio-left ${leftExpanded ? "expanded" : "collapsed"}`}
        aria-label="流程大纲侧栏"
      >
        {leftExpanded ? (
          <>
            <header>
              <span>
                <GitBranch size={15} /> 流程大纲
              </span>
              <button
                aria-label="收起流程大纲"
                onClick={() => setLeftOpen(false)}
              >
                <PanelLeftClose size={16} />
              </button>
            </header>
            <div className="studio-side-content">{outline(true)}</div>
          </>
        ) : (
          <button
            className="studio-rail"
            aria-label="展开流程大纲"
            aria-expanded={false}
            onClick={() => {
              if (canDockLeft && w.workflowOutlines?.length) setLeftOpen(true);
              else setDialog("outline");
            }}
          >
            <GitBranch size={16} />
            <span>流程大纲</span>
          </button>
        )}
      </aside>
      <div className="studio-chat">{children(openOutline)}</div>
      {hasReferences && (
        <aside
          className={`studio-side studio-right ${rightExpanded ? "expanded" : "collapsed"}`}
          aria-label="资料与资产侧栏"
        >
          {rightExpanded ? (
            <header>
              <span>
                <Folder size={15} /> 资料与资产
              </span>
              <button
                aria-label="收起资料与资产"
                onClick={() => setRightOpen(false)}
              >
                <PanelRightClose size={16} />
              </button>
            </header>
          ) : (
            <button
              className="studio-rail"
              aria-label="展开资料与资产"
              aria-expanded={false}
              onClick={() => {
                if (canDockRight) setRightOpen(true);
                else setDialog("references");
              }}
            >
              <Folder size={16} />
              <span>资料与资产</span>
            </button>
          )}
          <div className="studio-side-content" hidden={!rightExpanded}>
            <ProjectReferencePanel w={w} p={p} sessionId={sessionId} />
          </div>
        </aside>
      )}
      {dialog && (
        <PromptDialog
          title={dialog === "outline" ? "流程大纲" : "资料与资产"}
          closeLabel="关闭侧栏预览"
          onClose={() => setDialog(null)}
        >
          {dialog === "outline" ? (
            outline()
          ) : (
            <ProjectReferencePanel w={w} p={p} sessionId={sessionId} />
          )}
        </PromptDialog>
      )}
    </div>
  );
}
