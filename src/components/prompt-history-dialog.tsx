"use client";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { PromptSettings, PromptVersion } from "@/shared/agent-prompt";
import { PromptDialog } from "./prompt-dialog";
import { date } from "./ui";

export function PromptHistoryDialog({
  endpoint,
  settings,
  onClose,
}: {
  endpoint: string;
  settings: PromptSettings;
  onClose: () => void;
}) {
  const [version, setVersion] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<PromptVersion | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (version === null) return;
    const controller = new AbortController();
    api<PromptVersion>(`${endpoint}?version=${version}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [endpoint, version, attempt]);
  return (
    <PromptDialog
      title={`${settings.name} · 历史版本`}
      closeLabel="关闭历史版本"
      stacked
      onClose={onClose}
    >
      <div className="prompt-history">
        <div className="prompt-version-list" aria-label="提示词历史版本">
          {settings.versions.map((entry) => (
            <button
              type="button"
              key={entry.version}
              aria-pressed={version === entry.version}
              onClick={() => {
                setSnapshot(null);
                setError("");
                setVersion(entry.version);
                setAttempt((n) => n + 1);
              }}
            >
              <strong>v{entry.version}</strong>
              <span>
                {date(entry.createdAt)}
                {entry.origin === "baseline" ? " · 首次留档" : ""}
              </span>
            </button>
          ))}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}{" "}
            <button
              type="button"
              onClick={() => {
                setError("");
                setAttempt((n) => n + 1);
              }}
            >
              重试
            </button>
          </p>
        ) : snapshot ? (
          <>
            <p className="muted">
              v{snapshot.version} · 只读
              {snapshot.origin === "baseline"
                ? " · 开始版本管理时保存的配置，不代表旧消息当时的配置。"
                : ""}
            </p>
            <pre className="prompt-snapshot">
              {snapshot.instructions || "此版本未配置提示词"}
            </pre>
          </>
        ) : (
          <p className="muted" role="status">
            {version === null ? "选择一个版本查看完整提示词。" : "正在读取…"}
          </p>
        )}
      </div>
    </PromptDialog>
  );
}
