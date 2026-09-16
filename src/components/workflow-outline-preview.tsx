"use client";
import { useState } from "react";
import type { RecordData } from "@/client/api";
import type { WorkflowOutline } from "@/shared/workflow-outline";
import { PromptDialog } from "./prompt-dialog";
import { WorkflowGraph } from "./workflow-graph";

export function WorkflowOutlinePreview({ outline }: { outline: RecordData }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const content = outline.content as WorkflowOutline;
  const step = content.steps.find((r) => r.key === selected);
  return (
    <>
      <button
        type="button"
        className="workflow-outline-card"
        onClick={() => setOpen(true)}
      >
        <span>
          <strong>{content.title}</strong>
          <small>流程大纲 · 第 {String(outline.revision)} 版 · 待讨论</small>
        </span>
        <span>查看流程图 →</span>
      </button>
      {open && (
        <PromptDialog
          title={content.title}
          closeLabel="关闭流程大纲"
          onClose={() => setOpen(false)}
        >
          <div className="workflow-outline-preview">
            <p className="muted">
              第 {String(outline.revision)} 版草案 · 点击节点查看目标与交付物
            </p>
            <p>{content.summary}</p>
            <WorkflowGraph
              nodes={content.steps.map((r) => ({
                id: r.key,
                name: r.name,
                objective: r.objective,
                status: "draft",
              }))}
              dependencies={content.steps.flatMap((r) =>
                r.dependsOn.map((dep) => ({ node_id: r.key, depends_on: dep })),
              )}
              selectedId={selected}
              onSelect={setSelected}
            />
            {step && (
              <section
                className="outline-step-detail"
                aria-label="大纲节点详情"
              >
                <h3>{step.name}</h3>
                <p>{step.objective}</p>
                {step.outputs.length > 0 && (
                  <>
                    <strong>交付内容</strong>
                    <ul>
                      {step.outputs.map((output, i) => (
                        <li key={i}>{output}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
            {content.questions.length > 0 && (
              <section>
                <h3>待讨论</h3>
                <ul>
                  {content.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="muted">
              这是一份讨论草案。修改意见可以直接发给总控，预览不会启动制作。
            </p>
          </div>
        </PromptDialog>
      )}
    </>
  );
}
