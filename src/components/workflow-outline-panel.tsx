"use client";
import { useState } from "react";
import { GitBranch } from "lucide-react";
import { str, type RecordData } from "@/client/api";
import type { WorkflowOutline } from "@/shared/workflow-outline";
import { Empty } from "./ui";
import { PromptDialog } from "./prompt-dialog";
import { WorkflowOutlineContent } from "./workflow-outline-preview";

export function WorkflowOutlinePanel({
  outlines,
  selectedId,
  onSelect,
  compact = false,
}: {
  outlines: RecordData[];
  selectedId: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const [stepKey, setStepKey] = useState("");
  const selected = outlines.find((o) => o.id === selectedId) ?? outlines.at(-1);
  if (!selected)
    return (
      <section className="outline-workspace-panel">
        <Empty>流程大纲尚未生成。与总控讨论制作方向后，它会显示在这里。</Empty>
      </section>
    );
  const content = selected.content as WorkflowOutline;
  const step = content.steps.find((s) => s.key === stepKey);
  return (
    <section className="outline-workspace-panel" aria-label="流程大纲">
      <header>
        <h2>{str(selected.content as RecordData, "title")}</h2>
        {outlines.length > 1 && (
          <label>
            草案版本
            <select
              value={str(selected, "id")}
              onChange={(e) => onSelect(e.target.value)}
            >
              {[...outlines].reverse().map((o) => (
                <option key={str(o, "id")} value={str(o, "id")}>
                  {str(o.content as RecordData, "title")} · 第{" "}
                  {String(o.revision)} 版
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {compact ? (
        <>
          <button
            className="outline-open-full"
            onClick={() => setPreview(true)}
          >
            <GitBranch size={14} /> 查看完整流程图
          </button>
          <div className="outline-compact-steps">
            {content.steps.map((item, index) => (
              <button key={item.key} onClick={() => setStepKey(item.key)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{item.name}</strong>
                  {item.dependsOn.length > 0 && (
                    <small>
                      前置：
                      {item.dependsOn
                        .map(
                          (key) =>
                            content.steps.find((s) => s.key === key)?.name,
                        )
                        .join("、")}
                    </small>
                  )}
                </div>
              </button>
            ))}
          </div>
          {step && (
            <PromptDialog
              title={step.name}
              closeLabel="关闭大纲节点详情"
              onClose={() => setStepKey("")}
            >
              <p>{step.objective}</p>
              {step.outputs.length > 0 && (
                <>
                  <h3>交付内容</h3>
                  <ul>
                    {step.outputs.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </>
              )}
            </PromptDialog>
          )}
          {preview && (
            <PromptDialog
              title="完整流程大纲"
              closeLabel="关闭完整流程图"
              onClose={() => setPreview(false)}
            >
              <WorkflowOutlineContent outline={selected} />
            </PromptDialog>
          )}
        </>
      ) : (
        <WorkflowOutlineContent key={str(selected, "id")} outline={selected} />
      )}
    </section>
  );
}
