"use client";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { api } from "@/client/api";
import {
  AGENT_PROMPT_MAX_LENGTH,
  type PromptSettings,
  type PromptVersion,
} from "@/shared/agent-prompt";
import { PromptDialog } from "./prompt-dialog";
import { PromptHistoryDialog } from "./prompt-history-dialog";
import { PromptLayerView, SystemCapabilities } from "./prompt-layer-view";

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
  const [optionalTools, setOptionalTools] = useState<string[]>([]);
  const [optionalSkillIds, setOptionalSkillIds] = useState<string[]>([]);
  const [panel, setPanel] = useState<"content" | "system" | "capabilities">(
    "content",
  );
  const [baseVersion, setBaseVersion] = useState(0);
  const [history, setHistory] = useState(false);
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
        setOptionalTools(data.current.layers?.optionalTools ?? []);
        setOptionalSkillIds(
          data.current.layers?.optionalSkills.map((skill) => skill.id) ?? [],
        );
        setBaseVersion(data.current.version);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [endpoint, attempt]);
  const conflict = !!settings && settings.current.version !== baseVersion;
  const selectionChanged =
    !!settings &&
    (JSON.stringify([...optionalTools].sort()) !==
      JSON.stringify(
        [...(settings.current.layers?.optionalTools ?? [])].sort(),
      ) ||
      JSON.stringify([...optionalSkillIds].sort()) !==
        JSON.stringify(
          (
            settings.current.layers?.optionalSkills.map((skill) => skill.id) ??
            []
          ).sort(),
        ));
  return (
    <PromptDialog
      title={settings ? `${settings.name} · AI 设置` : "AI 设置"}
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
            <span className="prompt-current-version">
              当前配置 · v{settings.current.version}
            </span>
            <button
              type="button"
              aria-haspopup="dialog"
              disabled={busy}
              onClick={() => setHistory(true)}
            >
              历史版本
            </button>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || conflict || history) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const data = await api<PromptSettings>(endpoint, {
                  method: "PATCH",
                  body: JSON.stringify({
                    expectedVersion: baseVersion,
                    instructions: draft,
                    optionalTools,
                    optionalSkillIds,
                  }),
                });
                setSettings(data);
                setBaseVersion(data.current.version);
                setDraft(data.current.instructions);
                setOptionalTools(data.current.layers?.optionalTools ?? []);
                setOptionalSkillIds(
                  data.current.layers?.optionalSkills.map(
                    (skill) => skill.id,
                  ) ?? [],
                );
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
            <nav className="ai-config-tabs" aria-label="AI 配置分类">
              <button
                type="button"
                aria-pressed={panel === "content"}
                onClick={() => setPanel("content")}
              >
                内容提示词
              </button>
              <button
                type="button"
                aria-pressed={panel === "system"}
                onClick={() => setPanel("system")}
              >
                系统规则 · 只读
              </button>
              <button
                type="button"
                aria-pressed={panel === "capabilities"}
                onClick={() => setPanel("capabilities")}
              >
                工具与 Skill
              </button>
            </nav>
            <div hidden={panel !== "content"}>
              <p className="muted">
                编辑此 AI
                的专业定位、项目目标和内容要求。留空可清除自定义内容，系统规则始终保留。
              </p>
              <label className="field">
                <span>内容提示词 · 可编辑</span>
                <textarea
                  aria-label="内容提示词"
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
            </div>
            <div hidden={panel !== "system"}>
              <p className="muted">
                由平台维护，用户内容和选配 Skill 无法修改此配置。
              </p>
              <pre className="prompt-snapshot">
                {settings.current.layers?.system.instructions ??
                  "此历史配置尚未分层"}
              </pre>
            </div>
            <div hidden={panel !== "capabilities"}>
              {settings.current.layers && (
                <SystemCapabilities layers={settings.current.layers} />
              )}
              <section className="ai-config-section">
                <h3>用户选配 · 可修改</h3>
                <p className="muted">
                  仅展示此 AI 已获准的扩展能力。取消工具时一并取消依赖它的选配
                  Skill。
                </p>
                {settings.current.layers?.allowedTools.length ? (
                  settings.current.layers.allowedTools.map((tool) => (
                    <label className="ai-capability-option" key={tool}>
                      <input
                        type="checkbox"
                        checked={optionalTools.includes(tool)}
                        disabled={busy}
                        onChange={(e) => {
                          setOptionalTools((current) =>
                            e.target.checked
                              ? [...current, tool]
                              : current.filter((id) => id !== tool),
                          );
                          if (!e.target.checked)
                            setOptionalSkillIds((current) =>
                              current.filter(
                                (id) =>
                                  settings.availableSkills.find(
                                    (skill) => skill.id === id,
                                  )?.capability !== tool,
                              ),
                            );
                          setNotice("");
                        }}
                      />
                      <span>{tool}</span>
                    </label>
                  ))
                ) : (
                  <p className="muted">此 AI 暂无已配置的可选工具。</p>
                )}
                <h4>选配 Skill</h4>
                {settings.availableSkills.length ? (
                  settings.availableSkills.map((skill) => (
                    <label className="ai-capability-option" key={skill.id}>
                      <input
                        type="checkbox"
                        checked={optionalSkillIds.includes(skill.id)}
                        disabled={
                          busy || !optionalTools.includes(skill.capability)
                        }
                        onChange={(e) => {
                          setOptionalSkillIds((current) =>
                            e.target.checked
                              ? [...current, skill.id]
                              : current.filter((id) => id !== skill.id),
                          );
                          setNotice("");
                        }}
                      />
                      <span>
                        {skill.name} · v{skill.version}
                        <small>
                          {skill.description || `需要 ${skill.capability}`}
                        </small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="muted">暂无适用于此 AI 的已登记 Skill。</p>
                )}
              </section>
            </div>
            {conflict && (
              <div className="prompt-conflict">
                <strong>
                  最新版本已变为 v{settings.current.version}，你的编辑已保留
                </strong>
                <PromptLayerView snapshot={settings.current} />
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
                  (draft === settings.current.instructions && !selectionChanged)
                }
              >
                {busy ? "正在保存…" : "保存自定义配置"}
              </button>
            </div>
          </form>
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
      {history && settings && (
        <PromptHistoryDialog
          endpoint={endpoint}
          settings={settings}
          onClose={() => setHistory(false)}
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
            <PromptLayerView snapshot={snapshot} />
          ) : (
            <p role="status">正在读取…</p>
          )}
        </PromptDialog>
      )}
    </>
  );
}
