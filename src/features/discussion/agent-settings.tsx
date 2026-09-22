"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  agentKeys,
  agentNames,
  customFieldLabels,
  emptyCustomInstructions,
  type AgentKey,
  type CustomInstructions,
  type PromptSettings,
  type PromptExecution,
  type PromptLayers,
} from "@/domain/agent-config";
import {
  memberStages,
  stageTasks,
  latestTaskExecutions,
} from "./member-groups";
import { ExecutionBadge } from "./execution-status";
import type { StudioProject, TaskKind } from "@/domain";
import type { PromptApi } from "@/domain/agent-config";
import { StudioDialog } from "@/shared/ui/dialog";
import { ChatMarkdown } from "@/shared/ui/chat-markdown";
import { SkillSettings, SkillLoads } from "./skill-settings";

function memberKey(
  project: StudioProject,
  member: NonNullable<StudioProject["sessions"]>[number],
): AgentKey | undefined {
  if (member.role === "coordinator") return "coordinator";
  if (member.role === "reviewer") return "reviewer";
  const kind = project.tasks[member.scope]?.kind;
  if (kind === "storyboard") return "board";
  return agentKeys.includes(kind as AgentKey) ? (kind as AgentKey) : undefined;
}
export function AgentSettings({
  project,
  onClose,
  promptApi,
}: {
  project: StudioProject;
  onClose: () => void;
  promptApi: PromptApi;
}) {
  const [selected, setSelected] = useState<{
    key: AgentKey;
    title: string;
    kinds?: TaskKind[];
    scope?: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const activity = latestTaskExecutions(project);
  const normalized = query.trim().toLowerCase();
  if (selected)
    return (
      <AgentPromptDialog
        key={selected.key + selected.title}
        project={project}
        agentKey={selected.key}
        context={selected}
        promptApi={promptApi}
        onClose={() => setSelected(null)}
      />
    );
  return (
    <StudioDialog title="成员与职责" onClose={onClose} wide>
      <p className="studio-muted">
        按制作流程找负责人。每个节点的制作与审核独立沟通，规则和技能在对应角色中查看。
      </p>
      <div className="studio-agent-list studio-coordinator-member">
        <button
          onClick={() =>
            setSelected({ key: "coordinator", title: "总控 · 制作方向与需求" })
          }
        >
          <Settings2 size={18} />
          <span>
            <strong>总控 AI</strong>
            <small>制作方向与需求 · 跨节点协调 · 关键成果验收</small>
          </span>
          <ChevronRight size={16} />
        </button>
      </div>
      <label className="studio-organize-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="查找流程、角色或节点"
          aria-label="查找成员与节点"
        />
      </label>
      <div className="studio-member-stages">
        {memberStages.map((stage, index) => {
          const allTasks = stageTasks(project, stage.kinds);
          const matching = allTasks.filter((t) =>
            t.title.toLowerCase().includes(normalized),
          );
          const stageMatch =
            `${stage.title} ${stage.purpose} ${agentNames[stage.producer]}`
              .toLowerCase()
              .includes(normalized);
          if (normalized && !stageMatch && !matching.length) return null;
          const tasks = normalized && !stageMatch ? matching : allTasks;
          const active = allTasks.filter((t) =>
            ["working", "reviewing", "revising"].includes(
              activity.get(t.id)?.status ?? "",
            ),
          ).length;
          return (
            <details
              className="studio-member-stage"
              key={stage.id + normalized}
              open={!!normalized}
            >
              <summary>
                <span className="studio-stage-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{stage.title}</strong>
                  <small>{stage.purpose}</small>
                </span>
                <small className={active ? "studio-stage-working" : ""}>
                  {active ? `${active} 项处理中` : `${allTasks.length} 个节点`}
                </small>
                <ChevronDown size={16} />
              </summary>
              <div className="studio-member-stage-body">
                <div className="studio-member-role-pair studio-agent-list">
                  <button
                    onClick={() =>
                      setSelected({
                        key: stage.producer,
                        title: stage.title,
                        kinds: stage.kinds,
                      })
                    }
                  >
                    <Settings2 size={17} />
                    <span>
                      <small>制作方</small>
                      <strong>{agentNames[stage.producer]}</strong>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    onClick={() =>
                      setSelected({
                        key: "reviewer",
                        title: `${stage.title} · 节点审核`,
                        kinds: stage.kinds,
                      })
                    }
                  >
                    <ShieldCheck size={17} />
                    <span>
                      <small>审核方</small>
                      <strong>{stage.title}审核 AI</strong>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </div>
                {!!tasks.length && (
                  <details
                    className="studio-member-node-list"
                    open={!!normalized}
                  >
                    <summary>具体节点与会话 · {tasks.length}</summary>
                    {tasks.map((task) => (
                      <div className="studio-member-node" key={task.id}>
                        <div>
                          <strong>
                            {task.episode
                              ? `第 ${task.episode} 集${task.shot ? ` · 镜头 ${task.shot}` : ""} · `
                              : ""}
                            {task.title}
                          </strong>
                          {activity.has(task.id) && (
                            <ExecutionBadge
                              execution={activity.get(task.id)!}
                            />
                          )}
                        </div>
                        <div className="studio-member-node-actions">
                          {([stage.producer, "reviewer"] as AgentKey[]).map(
                            (key) => {
                              const session = project.sessions?.find(
                                (m) =>
                                  m.scope === task.id &&
                                  (key === "reviewer"
                                    ? m.role === "reviewer"
                                    : m.role !== "reviewer"),
                              );
                              return (
                                <button
                                  key={key}
                                  onClick={() =>
                                    setSelected({
                                      key,
                                      title: `${task.title} · ${key === "reviewer" ? "审核" : "制作"}`,
                                      kinds: [task.kind],
                                      scope: task.id,
                                    })
                                  }
                                >
                                  {key === "reviewer" ? "审核" : "制作"} ·{" "}
                                  {session?.threadId
                                    ? "查看会话与规则"
                                    : "查看规则"}
                                </button>
                              );
                            },
                          )}
                        </div>
                      </div>
                    ))}
                  </details>
                )}
                {!tasks.length && (
                  <p className="studio-muted">
                    尚未建立节点，可先查看或配置角色要求。
                  </p>
                )}
              </div>
            </details>
          );
        })}
        {normalized &&
          !memberStages.some(
            (stage) =>
              `${stage.title} ${stage.purpose} ${agentNames[stage.producer]}`
                .toLowerCase()
                .includes(normalized) ||
              stageTasks(project, stage.kinds).some((t) =>
                t.title.toLowerCase().includes(normalized),
              ),
          ) && <p className="studio-muted">没有匹配的流程或节点。</p>}
      </div>
      <p className="studio-muted studio-member-footer">
        视频生成与合成由人工完成。每个节点有独立审核会话；当前审核自定义使用本剧本共用模板。
      </p>
    </StudioDialog>
  );
}

function RuleLayers({ layers }: { layers: PromptLayers }) {
  return (
    <div className="studio-prompt-rules">
      <details>
        <summary>
          <LockKeyhole size={14} /> 系统规则 · 只读
        </summary>
        <ChatMarkdown
          text={
            layers.system +
            (layers.developer
              ? `\n\n## 执行工具要求\n\n${layers.developer}`
              : "")
          }
        />
      </details>
      <details>
        <summary>
          <LockKeyhole size={14} /> 角色职责与正反例 · 只读
        </summary>
        <ChatMarkdown text={layers.role} />
      </details>
      <details>
        <summary>系统工具与 Skill</summary>
        <ul>
          {layers.tools.map((tool) => (
            <li key={tool.id}>{tool.name}</li>
          ))}
        </ul>
        <p className="studio-muted">
          工具由系统按身份授予。技能按任务需要读取，不能扩大权限；目录中的条目不代表本轮已经加载。
        </p>
      </details>
      <small className="studio-muted">系统规则版本 {layers.rulesVersion}</small>
    </div>
  );
}
function AgentPromptDialog({
  project,
  agentKey,
  onClose,
  promptApi,
  context,
}: {
  context: { title: string; kinds?: TaskKind[]; scope?: string };
  project: StudioProject;
  agentKey: AgentKey;
  onClose: () => void;
  promptApi: PromptApi;
}) {
  const [settings, setSettings] = useState<PromptSettings | null>(null),
    [fields, setFields] = useState(emptyCustomInstructions);
  const [tab, setTab] = useState<"rules" | "custom" | "skills" | "history">(
    "rules",
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [version, setVersion] = useState<{
    revision: number;
    fields: CustomInstructions;
  } | null>(null);
  const [execution, setExecution] = useState<PromptExecution | null>(null);
  useEffect(() => {
    let alive = true;
    promptApi
      .settings(project.id, agentKey)
      .then((s) => {
        if (alive) {
          setSettings(s);
          setFields(s.fields);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [project.id, agentKey]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const scopedRuns =
    settings?.runs.filter((run) =>
      context.scope
        ? run.scope === context.scope
        : !context.kinds ||
          context.kinds.includes(project.tasks[run.scope]?.kind),
    ) ?? [];
  const scopedSessions = (project.sessions ?? []).filter(
    (m) =>
      memberKey(project, m) === agentKey &&
      (context.scope
        ? m.scope === context.scope
        : !context.kinds ||
          context.kinds.includes(project.tasks[m.scope]?.kind)),
  );
  const dirty =
    settings && JSON.stringify(settings.fields) !== JSON.stringify(fields);
  return (
    <StudioDialog
      title={`${context.title} · ${agentNames[agentKey]}`}
      onClose={onClose}
      wide
    >
      <button className="studio-member-back" onClick={onClose}>
        <ArrowLeft size={15} /> 返回流程成员
      </button>
      <p className="studio-muted">
        {agentKey === "reviewer"
          ? "此处只列本阶段相关技能；审核规则和自定义仍由本剧本各节点共用，修改会影响其他节点审核。"
          : "规则按本剧本的同类 AI 保存。"}
        新设置从下一轮执行生效。
      </p>
      <nav
        className="studio-detail-tabs studio-agent-tabs"
        aria-label="AI 配置栏目"
      >
        {(
          [
            ["rules", "规则与职责"],
            ["custom", "用户自定义"],
            ["skills", "按需技能"],
            ["history", "版本与执行"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="studio-notice warning" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="studio-notice" role="status">
          {notice}
        </p>
      )}
      {!settings && !error && <p>正在读取配置…</p>}
      {settings && (
        <>
          {tab === "rules" && (
            <>
              <div className="studio-role-summary">
                <strong>{agentNames[agentKey]}</strong>
                <p>
                  {agentKey === "reviewer"
                    ? "独立检查本节点产出，给出通过、退回或问题转交；由系统递交结果。"
                    : (memberStages.find((s) => s.producer === agentKey)
                        ?.purpose ??
                      "确认制作方向，协调各节点，处理重要取舍与验收。")}
                </p>
                <small>
                  完整要求与正反例在下方展开查看；制作方法见“按需技能”。
                </small>
              </div>
              <RuleLayers layers={settings.layers} />
            </>
          )}
          {tab === "skills" && (
            <SkillSettings
              projectId={project.id}
              agentKey={agentKey}
              api={promptApi}
              kinds={context.kinds}
            />
          )}
          {tab === "custom" && (
            <section className="studio-prompt-editor">
              <p className="studio-muted">
                补充内容风格与交付要求，不能改变系统权限或替代已确认方案。留空沿用默认；支持
                Markdown。
              </p>
              {Object.entries(customFieldLabels).map(([key, label]) => (
                <label className="studio-field" key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    rows={key === "identity" ? 2 : 3}
                    maxLength={
                      key === "requirements"
                        ? 12000
                        : key === "output"
                          ? 6000
                          : ["examples", "counterexamples"].includes(key)
                            ? 8000
                            : 4000
                    }
                    value={fields[key as keyof CustomInstructions]}
                    disabled={busy}
                    placeholder={
                      key === "counterexamples"
                        ? "错误做法 → 问题原因 → 期望做法"
                        : "未填写时使用默认要求"
                    }
                    onChange={(e) => {
                      setFields({ ...fields, [key]: e.target.value });
                      setNotice("");
                    }}
                  />
                </label>
              ))}
              <div className="studio-prompt-actions">
                <button
                  disabled={busy || !dirty}
                  className="studio-primary"
                  onClick={() =>
                    perform(async () => {
                      const saved = await promptApi.save(
                        project.id,
                        agentKey,
                        settings.revision,
                        fields,
                      );
                      setSettings(saved);
                      setFields(saved.fields);
                      setNotice(
                        `已保存为自定义 v${saved.revision}，下次执行生效。`,
                      );
                    })
                  }
                >
                  {busy ? "保存中…" : "保存自定义"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setFields(emptyCustomInstructions())}
                >
                  清空自定义
                </button>
                <small>
                  当前自定义{" "}
                  {settings.revision ? `v${settings.revision}` : "未设置"}
                  {dirty ? " · 有未保存修改" : ""}
                </small>
              </div>
            </section>
          )}
          {tab === "history" && (
            <section className="studio-prompt-history">
              <h3>自定义历史</h3>
              <p className="studio-muted">
                查看历史后可载入编辑，保存会产生新版本。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  perform(async () =>
                    setVersion(
                      await promptApi.version(project.id, agentKey, 0),
                    ),
                  )
                }
              >
                初始默认 · 无自定义
              </button>
              {settings.versions.map((v) => (
                <button
                  key={v.revision}
                  disabled={busy}
                  onClick={() =>
                    perform(async () =>
                      setVersion(
                        await promptApi.version(
                          project.id,
                          agentKey,
                          v.revision,
                        ),
                      ),
                    )
                  }
                >
                  自定义 v{v.revision}
                  <small>{new Date(v.createdAt).toLocaleString("zh-CN")}</small>
                </button>
              ))}
              <h3>最近执行使用的配置</h3>
              <p className="studio-muted">
                保留每次执行的固定配置，不随当前编辑改变。最多显示最近 20
                次执行，再按当前阶段筛选。
              </p>
              {!scopedRuns.length && <p>此 AI 尚无执行记录。</p>}
              {scopedRuns.map((run) => (
                <button
                  key={run.id}
                  disabled={busy}
                  onClick={() =>
                    perform(async () =>
                      setExecution(
                        await promptApi.execution(project.id, run.id),
                      ),
                    )
                  }
                >
                  <span>
                    {project.tasks[run.scope]?.title ?? "总控讨论"} ·{" "}
                    {new Date(run.time).toLocaleString("zh-CN")}
                  </span>
                  <small>
                    {run.revision === null
                      ? "旧版原始提示词"
                      : `自定义 v${run.revision}`}
                  </small>
                </button>
              ))}
            </section>
          )}
          <details className="studio-prompt-session">
            <summary>会话信息</summary>
            {scopedSessions.map((m) => (
              <p key={m.scope + m.role}>
                {project.tasks[m.scope]?.title ?? "总控讨论"}
                <br />
                <code>{m.threadId ?? "尚未建立会话"}</code>
              </p>
            ))}
            {!scopedSessions.length && (
              <p className="studio-muted">此范围尚未建立会话。</p>
            )}
            <p className="studio-muted">
              配置按 AI 类型保存；不同节点的会话分别保留。
            </p>
          </details>
        </>
      )}
      {version && (
        <StudioDialog
          title={`自定义历史 · ${version.revision ? `v${version.revision}` : "初始默认"}`}
          onClose={() => setVersion(null)}
        >
          {Object.entries(customFieldLabels).map(([key, label]) => (
            <section key={key}>
              <h3>{label}</h3>
              <ChatMarkdown
                text={
                  version.fields[key as keyof CustomInstructions] || "未设置"
                }
              />
            </section>
          ))}
          <button
            onClick={() => {
              setFields(version.fields);
              setVersion(null);
              setTab("custom");
              setNotice("已载入历史内容，点击保存后生效。");
            }}
          >
            载入编辑
          </button>
        </StudioDialog>
      )}
      {execution && (
        <StudioDialog
          title="执行时的规则与提示词"
          onClose={() => setExecution(null)}
          wide
        >
          <p className="studio-muted">
            {new Date(execution.time).toLocaleString("zh-CN")} ·{" "}
            {(
              {
                completed: "已完成",
                running: "执行中",
                failed: "执行失败",
                interrupted: "已中断",
                queued: "等待执行",
              } as Record<string, string>
            )[execution.status] ?? execution.status}
          </p>
          {execution.layers ? (
            <>
              <RuleLayers layers={execution.layers} />
              <h3>当时的用户自定义</h3>
              <ChatMarkdown text={execution.layers.custom} />
            </>
          ) : (
            <>
              <p className="studio-muted">
                该执行早于分层配置，以下仅展示当时保存的原始规则。
              </p>
              <ChatMarkdown text={execution.instructions} />
            </>
          )}
          <SkillLoads loads={execution.skillLoads ?? []} />
          <details className="studio-prompt-session">
            <summary>会话与本轮标识</summary>
            <p>
              <code>{execution.threadId ?? "尚未连接"}</code>
              <br />
              <code>{execution.turnId ?? "尚未开始本轮"}</code>
            </p>
          </details>
        </StudioDialog>
      )}
    </StudioDialog>
  );
}
