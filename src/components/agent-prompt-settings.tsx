"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings2, X, Library } from "lucide-react";
import { api } from "@/client/api";
import {
  AGENT_PROMPT_MAX_LENGTH,
  type PromptSettings,
  type PromptVersion,
} from "@/shared/agent-prompt";
import { date } from "./ui";
import { LibraryPendingDialog } from "./library-pending-dialog";

function PromptDialog({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog prompt-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="prompt-dialog-content">
        <div className="panel-heading">
          <h2>{title}</h2>
          <button
            type="button"
            aria-label="关闭设置"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function AgentPromptSettings({
  p,
  agentId,
  refresh,
}: {
  p: string;
  agentId: string;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="查看和修改此 AI 的提示词"
      >
        <Settings2 size={15} aria-hidden="true" />
        <span>AI 设置</span>
      </button>
      {open && (
        <AgentPromptEditor
          p={p}
          agentId={agentId}
          refresh={refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function AgentPromptEditor({
  p,
  agentId,
  refresh,
  onClose,
}: {
  p: string;
  agentId: string;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [baseVersion, setBaseVersion] = useState(0);
  const [history, setHistory] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selected, setSelected] = useState<PromptVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const endpoint = `/projects/${p}/agents/${agentId}/prompt`;
  useEffect(() => {
    const controller = new AbortController();
    api<PromptSettings>(endpoint, { signal: controller.signal })
      .then((data) => {
        setSettings(data);
        setDraft(data.current.instructions);
        setBaseVersion(data.current.version);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [endpoint, attempt]);
  const conflict = !!settings && settings.current.version !== baseVersion;
  return (
    <PromptDialog
      title={settings ? `${settings.name} · 提示词` : "AI 设置"}
      onClose={onClose}
      busy={busy}
    >
      {!settings ? (
        <p role="status">
          {error || "正在读取提示词…"}
          {error && (
            <button onClick={() => setAttempt((n) => n + 1)}>重试</button>
          )}
        </p>
      ) : (
        <>
          <div className="prompt-tabs" role="group" aria-label="提示词视图">
            <button
              type="button"
              aria-pressed={!history}
              onClick={() => setHistory(false)}
            >
              当前提示词 · v{settings.current.version}
            </button>
            <button
              type="button"
              aria-pressed={history}
              onClick={() => setHistory(true)}
            >
              历史版本
            </button>
            <button
              type="button"
              className="prompt-library-entry"
              aria-haspopup="dialog"
              disabled={busy}
              onClick={() => setLibraryOpen(true)}
            >
              <Library size={14} aria-hidden="true" /> 提示词库
            </button>
          </div>
          {history ? (
            <div className="prompt-history">
              <div className="prompt-version-list" aria-label="提示词历史版本">
                {settings.versions.map((version) => (
                  <button
                    type="button"
                    key={version.version}
                    disabled={busy}
                    aria-pressed={selected?.version === version.version}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        setSelected(
                          await api<PromptVersion>(
                            `${endpoint}?version=${version.version}`,
                          ),
                        );
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : "读取失败",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <strong>v{version.version}</strong>
                    <span>
                      {date(version.createdAt)}
                      {version.origin === "baseline" ? " · 首次留档" : ""}
                    </span>
                  </button>
                ))}
              </div>
              {selected ? (
                <>
                  <p className="muted">
                    v{selected.version} · 只读
                    {selected.origin === "baseline"
                      ? " · 开始版本管理时保存的配置，不代表旧消息当时的配置。"
                      : ""}
                  </p>
                  <pre className="prompt-snapshot">
                    {selected.instructions || "此版本未配置提示词"}
                  </pre>
                </>
              ) : (
                <p className="muted">选择一个版本查看完整提示词。</p>
              )}
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || conflict || libraryOpen) return;
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const data = await api<PromptSettings>(endpoint, {
                    method: "PATCH",
                    body: JSON.stringify({
                      expectedVersion: baseVersion,
                      instructions: draft,
                    }),
                  });
                  setSettings(data);
                  setBaseVersion(data.current.version);
                  setDraft(data.current.instructions);
                  setNotice(
                    `已保存 v${data.current.version}，之后提交的消息将关联这个版本。`,
                  );
                  try {
                    await refresh();
                  } catch {
                    setNotice(
                      `v${data.current.version} 已保存，页面同步失败，刷新页面即可查看。`,
                    );
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : "保存失败");
                  // Fetch the latest revision for comparison without discarding the local edit.
                  try {
                    setSettings(await api<PromptSettings>(endpoint));
                  } catch {
                    /* Keep the draft and original error for retry. */
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="muted">
                仅修改当前项目的这个
                AI。保存后用于后续消息，旧消息关联的版本保持不变。
              </p>
              <label className="field">
                <span>提示词</span>
                <textarea
                  aria-label="AI 提示词"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setNotice("");
                  }}
                  maxLength={AGENT_PROMPT_MAX_LENGTH}
                  rows={12}
                  disabled={busy}
                  spellCheck={false}
                />
              </label>
              {conflict && (
                <div className="prompt-conflict">
                  <strong>
                    最新版本已变为 v{settings.current.version}，你的编辑已保留
                  </strong>
                  <pre className="prompt-snapshot">
                    {settings.current.instructions}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      setBaseVersion(settings.current.version);
                      setError("");
                    }}
                  >
                    保留我的编辑，基于此版本继续
                  </button>
                </div>
              )}
              <div className="form-footer">
                <small className="muted">
                  {draft.length.toLocaleString()} 字符
                </small>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    conflict ||
                    !draft.trim() ||
                    draft === settings.current.instructions
                  }
                >
                  {busy ? "正在保存…" : "保存提示词"}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="prompt-saved">
              {notice}
            </p>
          )}
        </>
      )}
      {libraryOpen && (
        <LibraryPendingDialog
          title="提示词库"
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </PromptDialog>
  );
}

export function MessagePrompt({
  p,
  messageId,
  version,
}: {
  p: string;
  messageId: string;
  version: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PromptVersion | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api<{ snapshot: PromptVersion | null }>(
      `/projects/${p}/messages/${messageId}/prompt`,
      { signal: controller.signal },
    )
      .then((result) => {
        setSnapshot(result.snapshot);
        if (!result.snapshot) setError("这条历史消息没有留存提示词版本。");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [open, p, messageId]);
  if (!version)
    return (
      <small className="muted" title="这条历史消息没有留存提示词版本">
        提示词未留档
      </small>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        提示词 v{String(version)}
      </button>
      {open && (
        <PromptDialog
          title={`消息提示词 · v${String(version)}`}
          onClose={() => setOpen(false)}
        >
          <p className="muted">
            这是提交这条消息时关联的提示词，不代表模型已经执行。
          </p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : snapshot ? (
            <pre className="prompt-snapshot">
              {snapshot.instructions || "此版本未配置提示词"}
            </pre>
          ) : (
            <p role="status">正在读取…</p>
          )}
        </PromptDialog>
      )}
    </>
  );
}
