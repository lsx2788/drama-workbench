"use client";
import type { MediaFile } from "@/domain";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  FileText,
  History,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";
import { StudioDialog } from "@/shared/ui/dialog";
import { FilePreview } from "@/shared/ui/file-preview";
import { ChatMarkdown } from "@/shared/ui/chat-markdown";
import { Status } from "@/features/workflow/flow";
import { AssetImageButton, TaskAssetImages } from "./asset-images";
import { ManualHandoff } from "./manual-handoff";
import { draftMatches } from "./editor-state";
import { BoardReading } from "./board-reading";
import { VideoPrompt } from "./video-prompt";
import {
  approvedAssets,
  executorNames,
  isManual,
  kindNames,
  missingInputs,
  shotId,
  type StudioProject,
  type Task,
  type TaskAction,
} from "@/domain";

type Props = {
  project: StudioProject;
  task: Task;
  files: Record<string, MediaFile[]>;
  busy: boolean;
  error: string;
  onAction: (id: string, action: TaskAction) => Promise<boolean>;
  onFiles: (id: string, files: File[]) => Promise<boolean>;
  onSelect: (id: string) => void;
  onClose: () => void;
};
export function TaskDialog(props: Props) {
  const { project, task, onSelect, onClose } = props;
  const hasShot = task.episode !== undefined && task.shot !== undefined;
  return (
    <StudioDialog
      title={
        hasShot
          ? `第 ${String(task.episode).padStart(2, "0")} 集 · 镜头 ${String(task.shot).padStart(2, "0")}`
          : task.title
      }
      onClose={onClose}
      wide
    >
      {hasShot && (
        <nav className="studio-step-tabs" aria-label="镜头内部流程">
          {(["board", "assets", "frames", "video"] as const).map((kind, i) => (
            <button
              key={kind}
              className={task.kind === kind ? "active" : ""}
              onClick={() => onSelect(shotId(task.episode!, task.shot!, kind))}
            >
              <small>0{i + 1}</small>
              {kindNames[kind]}
            </button>
          ))}
        </nav>
      )}
      <TaskBody {...props} key={task.id} />
    </StudioDialog>
  );
}
function TaskBody({
  project,
  task,
  files,
  busy,
  error,
  onAction,
  onFiles,
  onSelect,
}: Props) {
  const [editingRevision, setEditingRevision] = useState(task.revision);
  const [baseline, setBaseline] = useState(task);
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [editingText, setEditingText] = useState(!task.text && !isManual(task));
  const [text, setText] = useState(task.text),
    [reason, setReason] = useState(task.reuseReason),
    [assetIds, setAssetIds] = useState(task.assetIds);
  const [query, setQuery] = useState(""),
    [history, setHistory] = useState(false),
    [rejecting, setRejecting] = useState(false),
    [rejection, setRejection] = useState("");
  const [tab, setTab] = useState<"work" | "chat" | "settings">("work");
  const [assetName, setAssetName] = useState(task.assetName ?? "");
  const [assetCategory, setAssetCategory] = useState<"人物" | "场景" | "道具">(
    task.assetCategory ?? "人物",
  );
  const inputs = missingInputs(project, task),
    manual = isManual(task),
    attachments = files[`${project.id}/${task.id}`] ?? [];
  const canEdit =
    task.enabled &&
    editingRevision === task.revision &&
    (manual || !inputs.length) &&
    task.delivery !== "approved" &&
    !busy;
  const draft = { text, reason, assetIds, assetName, assetCategory };
  const dirty = !draftMatches(draft, baseline);
  const reload = () => {
    setText(task.text);
    setReason(task.reuseReason);
    setAssetIds(task.assetIds);
    setAssetName(task.assetName ?? "");
    setAssetCategory(task.assetCategory ?? "人物");
    setEditingRevision(task.revision);
    setBaseline(task);
  };
  useEffect(() => {
    if (
      editingRevision !== task.revision &&
      (!dirty || draftMatches(draft, task))
    )
      reload();
  }, [dirty, editingRevision, task]);
  const candidates = approvedAssets(project, query);
  const contextMessages = project.events.filter((m) => m.taskId === task.id);
  const reviewControls = (
    <div className="studio-review-bar">
      <p>
        {manual
          ? "播放并核对视频后，在这里记录验收结果。"
          : "审核与流程推进由总控把控，用户可按需介入。"}
      </p>
      <small>
        {manual
          ? "核对镜头动作、时长、声音、实际尺寸及与前置画面的衔接；上传不等于验收。"
          : "系统自动衔接节点审核，总控负责最终验收；人工操作单独留痕。"}
      </small>
      <details open={manual}>
        <summary>{manual ? "视频验收" : "人工介入"}</summary>
        <div className="studio-review-actions">
          {task.reviewEnabled && !manual && (
            <button
              disabled={
                busy ||
                task.delivery !== "draft" ||
                !task.enabled ||
                !!inputs.length ||
                dirty
              }
              onClick={() => onAction(task.id, { type: "review" })}
            >
              <ShieldCheck size={14} />
              人工内容审核通过
            </button>
          )}
          <button
            className="studio-primary"
            disabled={
              busy ||
              !task.enabled ||
              !!inputs.length ||
              dirty ||
              (manual &&
                !attachments.some((f) => f.type.startsWith("video/"))) ||
              !["draft", "reviewed"].includes(task.delivery)
            }
            onClick={() =>
              onAction(task.id, {
                type: "accept",
                mediaPresent: attachments.some((f) =>
                  f.type.startsWith("video/"),
                ),
                imagesPresent: attachments.some((f) =>
                  f.type.startsWith("image/"),
                ),
              })
            }
          >
            <Check size={14} />
            人工验收通过
          </button>
          <button
            disabled={
              busy ||
              !["draft", "reviewed"].includes(task.delivery) ||
              !task.enabled ||
              !!inputs.length
            }
            onClick={() => setRejecting(true)}
          >
            退回修改
          </button>
        </div>
      </details>
    </div>
  );
  const outputSection = (
    <section className="studio-output">
      <div className="studio-output-heading">
        <strong>
          {manual
            ? "分镜词 / 人工制作说明"
            : task.kind === "frames"
              ? "首帧、关键动作图、尾帧说明"
              : "产出文本"}
        </strong>
        {canEdit && (
          <button onClick={() => setEditingText(!editingText)}>
            {editingText ? "预览" : "编辑原文"}
          </button>
        )}
      </div>
      {editingText && canEdit ? (
        <textarea
          aria-label="编辑产出文本"
          rows={9}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canEdit}
          placeholder="在这里保存这一环节的产出或制作说明…"
        />
      ) : (
        <div
          className={`studio-output-reading ${task.kind === "board" ? "studio-board-output" : ""}`}
          role="region"
          aria-label="产出正文"
          tabIndex={0}
        >
          {text ? (
            task.kind === "board" ? (
              <BoardReading text={text} />
            ) : (
              <ChatMarkdown text={text} />
            )
          ) : (
            <p className="studio-muted">暂无产出文本</p>
          )}
        </div>
      )}
    </section>
  );
  return (
    <div className="studio-task-detail">
      <div className="studio-task-heading">
        <div>
          <small>
            {kindNames[task.kind]} · 产出{" "}
            {task.revision ? `v${task.revision}` : "未提交"}
          </small>
          <h3>{task.title}</h3>
        </div>
        <Status project={project} task={task} />
      </div>
      {!task.enabled ? (
        <p className="studio-notice">
          <Pause size={14} />
          {task.retirement
            ? `此资产已清理：${task.retirement.reason}。历史记录保留，如需继续请让总控恢复任务。`
            : "此任务已暂停，其他不依赖本次产出的任务仍可开展。"}
        </p>
      ) : (
        !!inputs.length && (
          <p className="studio-notice">
            等待 {inputs.length}{" "}
            项必要输入。可以查看或预览已有文件，待前置产出验收后提交。
          </p>
        )
      )}
      {editingRevision !== task.revision && (
        <p className="studio-notice">
          产出有新版本，当前编辑内容已保留。
          <button onClick={reload}>载入最新版本</button>
        </p>
      )}
      {task.rejection && (
        <p className="studio-notice warning">退回原因：{task.rejection}</p>
      )}
      {error && (
        <p className="studio-notice warning" role="alert">
          {error}
        </p>
      )}
      <div className="studio-detail-tabs">
        <button
          className={tab === "work" ? "active" : ""}
          onClick={() => setTab("work")}
        >
          当前成果
        </button>
        <button
          className={tab === "chat" ? "active" : ""}
          onClick={() => setTab("chat")}
        >
          节点记录 · {contextMessages.length}
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          设置与审核
        </button>
      </div>
      {tab === "settings" ? (
        <div className="studio-task-settings">
          {" "}
          <p className="studio-muted">{task.objective}</p>
          {task.kind === "assets" && task.reuseReason && (
            <details className="studio-secondary-section">
              <summary>资产查询与复用依据</summary>
              <ChatMarkdown text={task.reuseReason} />
            </details>
          )}
          {!!task.dependencies.length && (
            <div className="studio-input-links">
              <small>输入依据</small>
              {task.dependencies.map((id) => (
                <button onClick={() => onSelect(id)} key={id}>
                  <FileText size={12} />
                  {project.tasks[id].shot && project.tasks[id].kind !== "board"
                    ? `镜头 ${String(project.tasks[id].shot).padStart(2, "0")} · `
                    : ""}
                  {project.tasks[id].title}
                  <span>
                    {project.tasks[id].delivery === "approved" ? "✓" : "待验收"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {task.kind === "episode" && (
            <div className="studio-input-links">
              {[
                `episode-${task.episode}-storyboard`,
                `episode-${task.episode}-assembly`,
              ]
                .filter((id) => project.tasks[id])
                .map((id) => (
                  <button key={id} onClick={() => onSelect(id)}>
                    {project.tasks[id].title}
                    <ChevronRight size={12} />
                  </button>
                ))}
            </div>
          )}
          <div className="studio-members">
            <div>
              <UserRound size={18} />
              <span>
                <strong>{executorNames[task.kind]}</strong>
                <small>{task.enabled ? "执行已启用" : "当前任务暂停"}</small>
              </span>
              <button
                disabled={busy || !!task.retirement}
                className={task.enabled ? "studio-switch on" : "studio-switch"}
                role="switch"
                aria-checked={task.enabled}
                aria-label={`${task.enabled ? "暂停" : "恢复"}${executorNames[task.kind]}`}
                onClick={() => onAction(task.id, { type: "toggle-executor" })}
              >
                <i />
              </button>
            </div>
            {!manual && (
              <div>
                <ShieldCheck size={18} />
                <span>
                  <strong>{task.title} · 审核 AI</strong>
                  <small>
                    {task.reviewEnabled
                      ? "检查内容与基准"
                      : "用户禁用 · 跳过内部审核"}
                  </small>
                </span>
                <button
                  disabled={busy || task.delivery === "approved"}
                  className={
                    task.reviewEnabled ? "studio-switch on" : "studio-switch"
                  }
                  role="switch"
                  aria-checked={task.reviewEnabled}
                  aria-label={`${task.reviewEnabled ? "禁用" : "启用"}审核 AI`}
                  onClick={() => onAction(task.id, { type: "toggle-review" })}
                >
                  <i />
                </button>
              </div>
            )}
          </div>
          {reviewControls}
        </div>
      ) : tab === "chat" ? (
        <div className="studio-node-records">
          {!!task.history.length && (
            <button onClick={() => setHistory(true)}>
              <History size={13} />
              查看历史版本
            </button>
          )}
          {contextMessages.length ? (
            contextMessages.map((m) => (
              <article key={m.id}>
                <strong>操作记录 · v{m.revision}</strong>
                <ChatMarkdown text={m.text} />
              </article>
            ))
          ) : (
            <p className="studio-muted">
              此节点还没有操作记录。总控安排的任务与审核会记录在这里。
            </p>
          )}
          <p className="studio-muted">
            此处展示已保存的节点操作记录；总控页可记录讨论。
          </p>
        </div>
      ) : (
        <>
          {task.structure && (
            <details className="studio-output-structure">
              <summary>
                {task.structure.kind === "episodes" ? "分集剧本" : "镜头内容"} ·{" "}
                {task.structure.items.length} 项 · 关键编号{" "}
                {task.structure.representative}
              </summary>
              <p>{task.structure.reason}</p>
              {task.structure.items.map((item) => (
                <details key={item.number}>
                  <summary>
                    {item.number} · {item.title}
                  </summary>
                  <ChatMarkdown text={item.text} />
                </details>
              ))}
            </details>
          )}
          {manual && (
            <ManualHandoff
              project={project}
              task={task}
              files={files}
              onSelect={onSelect}
            />
          )}
          {task.kind === "assets" && (
            <TaskAssetImages
              project={project}
              task={task}
              attachments={attachments}
              onPreview={setPreviewFile}
            />
          )}
          {task.kind === "assets" && canEdit && (
            <details className="studio-secondary-section">
              <summary>添加 / 调整关联资产</summary>{" "}
              <section className="studio-asset-query">
                <h4>可复用的已通过资产</h4>
                <p className="studio-muted">
                  以下是公共资产候选；勾选后保存，才会用于当前节点。
                </p>
                <label className="studio-search">
                  <Search size={15} />
                  <input
                    placeholder="按人物、年龄、服装、场景查询"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="studio-candidates">
                  {candidates.map((asset) => (
                    <div className="studio-asset-candidate" key={asset.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={assetIds.includes(asset.id)}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setAssetIds((ids) =>
                              e.target.checked
                                ? [...ids, asset.id]
                                : ids.filter((id) => id !== asset.id),
                            )
                          }
                        />
                        <span>
                          <strong>{asset.name}</strong>
                          <small>
                            {task.assetIds.includes(asset.id)
                              ? "当前节点已关联"
                              : assetIds.includes(asset.id)
                                ? "已选择 · 尚未保存"
                                : "尚未关联"}{" "}
                            · {asset.category} · v{asset.version}
                          </small>
                          <small>{asset.description}</small>
                        </span>
                      </label>
                      <div className="studio-task-asset-thumbnails">
                        {(asset.files ?? [])
                          .filter((f) => f.type.startsWith("image/"))
                          .map((f) => (
                            <AssetImageButton
                              key={f.id ?? f.url}
                              file={f}
                              onPreview={setPreviewFile}
                            />
                          ))}
                      </div>
                    </div>
                  ))}
                  {!candidates.length && (
                    <p className="studio-muted">
                      没有符合查询条件的已通过资产。
                    </p>
                  )}
                </div>
                <label className="studio-field">
                  查询与复用判断
                  <textarea
                    value={reason}
                    disabled={!canEdit}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="记录查询条件、适用资产；存在却不用的，要说明差异。未查到也应记录。"
                  />
                </label>
                <small className="studio-muted">
                  审核需核查已有资产不被复用的理由。角色设定文本不等于已经制作好的角色图。
                </small>
              </section>
            </details>
          )}
          {(manual ||
            task.kind === "frames" ||
            (task.kind === "assets" && canEdit)) && (
            <section className="studio-deliverables">
              {task.kind === "assets" && (
                <section className="studio-new-asset-fields">
                  <label className="studio-field">
                    新建图片资产名称
                    <input
                      value={assetName}
                      disabled={!canEdit}
                      onChange={(e) => setAssetName(e.target.value)}
                      placeholder="如：沈青禾 · 24 岁 · 青灰外衣"
                    />
                  </label>
                  <div className="studio-filter-row">
                    {(["人物", "场景", "道具"] as const).map((kind) => (
                      <button
                        disabled={!canEdit}
                        className={assetCategory === kind ? "active" : ""}
                        key={kind}
                        onClick={() => setAssetCategory(kind)}
                      >
                        {kind}
                      </button>
                    ))}
                  </div>
                  <small className="studio-muted">
                    同一资产的一组图片共用一个名称与分类；保存后，验收通过即进入公共资产库。
                  </small>
                </section>
              )}
              <div>
                <h4>
                  {manual
                    ? "人工视频"
                    : task.kind === "assets"
                      ? "本节点直接上传的图片"
                      : "画面文件"}
                </h4>
                <label
                  className={`studio-upload-button ${!canEdit ? "disabled" : ""}`}
                >
                  <Upload size={14} />
                  {manual ? "添加视频" : "添加图片"}
                  <input
                    type="file"
                    hidden
                    multiple
                    accept={manual ? "video/*" : "image/*"}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const accepted = [...(e.target.files ?? [])].filter((f) =>
                        f.type.startsWith(manual ? "video/" : "image/"),
                      );
                      if (accepted.length) void onFiles(task.id, accepted);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {task.kind === "assets" ? null : attachments.length ? (
                <div className="studio-media-grid">
                  {attachments.map((f, i) => (
                    <FilePreview file={f} key={`${f.name}-${i}`} />
                  ))}
                </div>
              ) : (
                <p className="studio-muted">
                  {`尚未添加${manual ? "视频" : "图片"}。上传文件保存在本机服务，可在流程和资产库查看。`}
                </p>
              )}
            </section>
          )}
          {task.kind === "frames" && task.delivery === "approved" && (
            <VideoPrompt text={task.text} />
          )}
          {["assets", "frames"].includes(task.kind) &&
          !(editingText && canEdit) ? (
            <details className="studio-secondary-section">
              <summary>制作说明与提示词</summary>
              {outputSection}
            </details>
          ) : (
            outputSection
          )}
          {manual && (
            <p className="studio-muted">
              视频由人工在外部制作，再添加到此节点。本页不自动生成或合成视频。
            </p>
          )}
          <div className="studio-text-actions">
            {canEdit && dirty && (
              <button
                disabled={!canEdit || !text.trim() || !dirty}
                onClick={async () => {
                  if (
                    await onAction(task.id, {
                      type: "save",
                      text,
                      assetIds,
                      reuseReason: reason,
                      assetName,
                      assetCategory,
                    })
                  )
                    setEditingText(false);
                }}
              >
                保存文本
              </button>
            )}
          </div>
          {manual && reviewControls}
        </>
      )}
      {history && (
        <StudioDialog title="产出历史" onClose={() => setHistory(false)}>
          {task.history.map((h, i) => (
            <article className="studio-history" key={i}>
              <strong>v{h.revision}</strong>
              <ChatMarkdown text={h.text} />
            </article>
          ))}
        </StudioDialog>
      )}
      {previewFile && (
        <StudioDialog
          title={previewFile.name}
          onClose={() => setPreviewFile(null)}
          wide
        >
          <FilePreview file={previewFile} zoomable />
        </StudioDialog>
      )}
      {rejecting && (
        <StudioDialog title="退回修改" onClose={() => setRejecting(false)}>
          <label className="studio-field">
            说明需要修改的问题
            <textarea
              value={rejection}
              onChange={(e) => setRejection(e.target.value)}
              rows={4}
            />
          </label>
          <button
            disabled={busy || !rejection.trim()}
            className="studio-primary"
            onClick={async () => {
              if (
                await onAction(task.id, { type: "return", reason: rejection })
              )
                setRejecting(false);
            }}
          >
            确认退回
          </button>
        </StudioDialog>
      )}
    </div>
  );
}
