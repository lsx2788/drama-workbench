"use client";
import { useState } from "react";
import { GitBranch } from "lucide-react";
import { str, type RecordData } from "@/client/api";
import {
  withFixedOutlineStart,
  FIXED_OUTLINE_KEYS,
  type WorkflowOutline,
} from "@/shared/workflow-outline";
import { PromptDialog } from "./prompt-dialog";
import { WorkflowOutlineContent } from "./workflow-outline-preview";

export function WorkflowOutlinePanel({
  outlines,
  compact = false,
}: {
  outlines: RecordData[];
  compact?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const [stepKey, setStepKey] = useState("");
  const selected = outlines.find((o) => o.status === "confirmed");
  if (!selected)
    return (
      <section className="outline-workspace-panel" aria-label="流程大纲" />
    );
  const rawContent = selected.content as WorkflowOutline;
  const content = {
    ...rawContent,
    steps: withFixedOutlineStart(rawContent.steps),
  };
  const step = content.steps.find((s) => s.key === stepKey);
  return (
    <section className="outline-workspace-panel" aria-label="流程大纲">
      <header>
        <h2>{str(selected.content as RecordData, "title")}</h2>
        <small>已确认</small>
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
                  {FIXED_OUTLINE_KEYS.has(item.key) && <small>固定环节</small>}
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
