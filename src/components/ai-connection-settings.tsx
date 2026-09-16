"use client";
import { useState } from "react";
import { api } from "@/client/api";
import type { AiConnectionStatus } from "@/shared/ai-connection";
import { PromptDialog } from "./prompt-dialog";
import { OpenaiSettings } from "./openai-settings";

export function AiConnectionSettings({
  value,
  changed,
}: {
  value: AiConnectionStatus | null;
  changed: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function update(provider: "codex" | "openai", model?: string) {
    setBusy(true);
    setError("");
    try {
      await api("/ai-connection", {
        method: "PATCH",
        body: JSON.stringify({ provider, ...(model ? { model } : {}) }),
      });
      await changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="ai-connect-button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {value?.provider === "codex" ? "本机 Codex" : "OpenAI API"} ·{" "}
        {value?.configured ? "已连接" : "未连接"}
      </button>
      {open && (
        <PromptDialog
          title="AI 连接"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <div className="ai-settings-form">
            <div className="form-actions">
              <button
                type="button"
                className={value?.provider === "codex" ? "primary" : ""}
                disabled={busy}
                onClick={() => void update("codex")}
              >
                本机 Codex
              </button>
              <button
                type="button"
                className={value?.provider === "openai" ? "primary" : ""}
                disabled={busy}
                onClick={() => void update("openai")}
              >
                OpenAI API
              </button>
            </div>
            <p className="muted">{value?.message ?? "选择连接方式"}</p>
            {value?.provider === "codex" ? (
              <>
                <label>
                  模型
                  <select
                    aria-label="Codex 模型"
                    value={value.model}
                    disabled={busy || !value.models.length}
                    onChange={(e) => void update("codex", e.target.value)}
                  >
                    {value.models.map((m) => (
                      <option key={m.model} value={m.model}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <small className="muted">
                  使用这台电脑的 ChatGPT 登录，无需 API
                  Key。电脑与工作台服务需要保持运行。
                  {value.imageGeneration
                    ? "已支持图片生成。"
                    : "当前连接未提供图片生成能力。"}
                </small>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api("/ai-connection/test", { method: "POST" });
                      await changed();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "检测失败");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "检测中…" : "重新检测连接"}
                </button>
              </>
            ) : (
              <OpenaiSettings
                value={
                  value
                    ? {
                        configured: value.configured,
                        model: value.model,
                        imageModel: value.imageModel ?? "",
                        keySource: value.keySource ?? "",
                      }
                    : null
                }
                changed={changed}
              />
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </div>
        </PromptDialog>
      )}
    </>
  );
}
