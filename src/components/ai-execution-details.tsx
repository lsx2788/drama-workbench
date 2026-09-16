"use client";
import { useState } from "react";
import { api, list, str, type RecordData } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";
import { date } from "./ui";

export function AiExecutionDetails({
  p,
  turns,
}: {
  p: string;
  turns: RecordData[];
}) {
  const [selected, setSelected] = useState<RecordData | null>(null),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  if (!turns.length) return null;
  const status: Record<string, string> = {
    queued: "等待处理",
    running: "处理中",
    completed: "已完成",
    failed: "未完成",
    interrupted: "已中断",
  };
  return (
    <details className="session-meta">
      <summary>AI 执行记录</summary>
      {turns.map((t) => (
        <button
          key={str(t, "id")}
          type="button"
          onClick={async () => {
            setSelected(null);
            setError("");
            setOpen(true);
            try {
              setSelected(
                await api<RecordData>(`/projects/${p}/ai-turns/${t.id}`),
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "读取失败");
            }
          }}
        >
          {date(t.created_at)} · {status[str(t, "status")]}
        </button>
      ))}
      {open && (
        <PromptDialog title="本次实际执行" onClose={() => setOpen(false)}>
          {error ? (
            <p role="alert">{error}</p>
          ) : !selected ? (
            <p>正在读取…</p>
          ) : (
            <>
              <p>状态：{status[str(selected, "status")]}</p>
              <details>
                <summary>执行配置与提示词快照</summary>
                <pre className="ai-audit-json">
                  {JSON.stringify(
                    JSON.parse(str(selected, "config_json")),
                    null,
                    2,
                  )}
                </pre>
              </details>
              {list(selected.calls).map((call, index) => (
                <details key={str(call, "id")}>
                  <summary>
                    模型调用 {index + 1} ·{" "}
                    {str(call, "response_id") || "未取得响应编号"}
                  </summary>
                  <pre className="ai-audit-json">
                    {JSON.stringify(
                      {
                        input: JSON.parse(str(call, "input_json")),
                        output: call.output_json
                          ? JSON.parse(str(call, "output_json"))
                          : null,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
              <details>
                <summary>工具与协作记录</summary>
                <pre className="ai-audit-json">
                  {JSON.stringify(selected.tools, null, 2)}
                </pre>
              </details>
            </>
          )}
        </PromptDialog>
      )}
    </details>
  );
}
