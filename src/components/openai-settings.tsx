"use client";
import { useState } from "react";
import { api } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";

export type OpenaiSettingsValue = {
  configured: boolean;
  model: string;
  imageModel: string;
  keySource: string;
};
export function OpenaiSettings({
  value,
  changed,
}: {
  value: OpenaiSettingsValue | null;
  changed: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [key, setKey] = useState(""),
    [model, setModel] = useState(""),
    [imageModel, setImageModel] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <>
      <button
        type="button"
        className="ai-connect-button"
        onClick={() => {
          setModel(value?.model ?? "gpt-6-astra");
          setImageModel(value?.imageModel ?? "gpt-image-2.5-sunburst");
          setError("");
          setNotice("");
          setOpen(true);
        }}
      >
        {value?.configured ? "OpenAI · 已配置" : "连接 OpenAI"}
      </button>
      {open && (
        <PromptDialog
          title="连接 OpenAI"
          busy={busy}
          onClose={() => {
            setKey("");
            setOpen(false);
          }}
        >
          <form
            className="ai-settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await api("/openai", {
                  method: "PATCH",
                  body: JSON.stringify({
                    ...(key.trim() ? { apiKey: key } : {}),
                    model,
                    imageModel,
                  }),
                });
                setKey("");
                await changed();
                setNotice("连接配置已保存。");
              } catch (e) {
                setError(e instanceof Error ? e.message : "保存失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  value?.configured
                    ? "已保存，留空保持原密钥"
                    : "填写 OpenAI API Key"
                }
              />
            </label>
            <small className="muted">
              密钥仅存本机后端，不会显示在聊天或提交到
              GitHub。所有项目共用此连接。
              {value?.keySource === "environment"
                ? "当前使用环境变量中的密钥与模型配置。"
                : ""}
            </small>
            <label>
              文字与视觉模型
              <input
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              图片生成模型
              <input
                required
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
              />
            </label>
            <small className="muted">
              API 独立计费；请填写你的账号可用的模型名称。
            </small>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            <div className="form-actions">
              <button
                type="button"
                disabled={busy || !value?.configured}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    const r = await api<{ message: string }>("/openai/test", {
                      method: "POST",
                    });
                    setNotice(r.message);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "连接失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                测试已保存连接
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "处理中…" : "保存连接"}
              </button>
            </div>
          </form>
        </PromptDialog>
      )}
    </>
  );
}
