import type { MediaFile, StudioProject, Task } from "./types";
import { isManual, missingInputs } from "./queries";

export function manualReadyTasks(project: StudioProject) {
  return Object.values(project.tasks).filter(
    (task) =>
      isManual(task) &&
      task.enabled &&
      task.delivery !== "approved" &&
      !missingInputs(project, task).length,
  );
}

export function manualHandoff(
  project: StudioProject,
  task: Task,
  files: Record<string, MediaFile[]>,
) {
  const seen = new Set<string>();
  const sources: Task[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const source = project.tasks[id];
    if (!source) return;
    // The handoff concerns this shot / episode. Do not export the whole novel.
    if (["frames", "assets", "board", "video"].includes(source.kind)) {
      if (task.kind !== "assembly") source.dependencies.forEach(visit);
      sources.push(source);
    }
  };
  task.dependencies.forEach(visit);
  if (task.kind === "assembly") {
    const storyboard = project.tasks[`episode-${task.episode}-storyboard`];
    if (storyboard) sources.unshift(storyboard);
  }
  if (project.tasks.brief) sources.unshift(project.tasks.brief);
  const inputs = sources.map((source) => ({
    task: source,
    files:
      source.delivery === "approved"
        ? (files[`${project.id}/${source.id}`] ?? []).filter(
            (file) => !file.trashed,
          )
        : [],
    acceptance: project.events.filter(
      (event) =>
        event.taskId === source.id &&
        event.revision === source.revision &&
        event.action === "accept",
    ),
    assets:
      source.delivery === "approved"
        ? project.assets.filter(
            (asset) =>
              source.assetIds.includes(asset.id) && asset.status === "approved",
          )
        : [],
  }));
  const primary = inputs.filter(
    (input) =>
      task.dependencies.includes(input.task.id) &&
      input.task.kind === (task.kind === "video" ? "frames" : "video"),
  );
  const ready =
    task.enabled &&
    !missingInputs(project, task).length &&
    primary.length > 0 &&
    primary.every(
      (input) =>
        input.task.delivery === "approved" &&
        input.files.some((file) =>
          file.type.startsWith(task.kind === "video" ? "image/" : "video/"),
        ),
    );
  const heading = `第 ${task.episode ?? "—"} 集${task.shot ? ` · 镜头 ${task.shot}` : " · 整集"} · 人工制作交接`;
  const text = [
    `# ${heading}`,
    `剧本：${project.name}`,
    `目标节点：${task.id}`,
    ready
      ? "状态：前置文件已验收，可开始人工制作。"
      : "状态：前置成果或文件尚未齐全，不能作为完整交接。",
    "## 使用顺序\n1. 先核对已验收画面与对应验收备注（含本镜头例外）。\n2. 阅读资产包中的正式修订，再结合原分镜制作。早期分镜原文可能尚未包含后续修订；出现冲突时先确认，不直接照抄旧提示词。\n3. 外部制作后回到目标节点上传视频，核对画面、时长、声音与要求后验收。\n\n本文件汇集原始依据，不是重新编写的视频生成提示词。图片尺寸为原文件实际像素；不等于全剧交付规格。",
    ...inputs.map((input) =>
      [
        `## ${input.task.title} · v${input.task.revision} · ${input.task.delivery === "approved" ? "已验收" : "未验收"}`,
        `节点：${input.task.id}`,
        ...input.files.map(
          (file) =>
            `- 文件：[${file.name}](${file.url})${file.width && file.height ? ` · 原文件 ${file.width}×${file.height}` : ""}`,
        ),
        ...input.assets.map(
          (asset) =>
            `### 引用资产：${asset.name} · v${asset.version}\n${(
              asset.files ?? []
            )
              .filter((file) => !file.trashed)
              .map(
                (file) =>
                  `- [${file.name}](${file.url})${file.width && file.height ? ` · 原文件 ${file.width}×${file.height}` : ""}`,
              )
              .join("\n")}`,
        ),
        ...input.acceptance.map((event) => `### 本版验收备注\n${event.text}`),
        `### 本版原文\n${input.task.text || "暂无文本"}`,
      ].join("\n\n"),
    ),
  ].join("\n\n");
  return { heading, ready, inputs, primary, text };
}
