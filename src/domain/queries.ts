import type { TaskKind, Task, StudioProject, Asset } from "./types";
export const kindNames: Record<TaskKind, string> = {
  source: "原作理解",
  brief: "制作需求",
  script: "整体剧本",
  episode: "分集剧本",
  storyboard: "分集分镜设计",
  board: "分镜设计",
  assets: "基础资产",
  frames: "镜头画面",
  video: "镜头视频",
  assembly: "整集视频",
};
export const executorNames: Record<TaskKind, string> = {
  source: "原作分析 AI",
  brief: "总控 AI",
  script: "编剧 AI",
  episode: "编剧 AI",
  storyboard: "分镜 AI",
  board: "分镜 AI",
  assets: "资产制作 AI",
  frames: "画面制作 AI",
  video: "人工制作",
  assembly: "人工合成",
};
export const isManual = (task: Task) =>
  task.kind === "video" || task.kind === "assembly";
export const epId = (n: number) => `episode-${n}`;
export const shotId = (n: number, s: number, kind: string = "board") =>
  `episode-${n}-shot-${s}-${kind}`;
export function taskDisplayTitle(task: Task): string {
  if (!task.episode) return task.title;
  const parts = [`第 ${task.episode} 集`];
  let title = task.title.replace(
    new RegExp(`^第\\s*0*${task.episode}\\s*集\\s*[·:：]?\\s*`),
    "",
  );
  if (task.shot) {
    parts.push(`镜头 ${String(task.shot).padStart(2, "0")}`);
    title = title.replace(
      new RegExp(`^镜头\\s*0*${task.shot}\\s*[·:：]?\\s*`),
      "",
    );
  }
  if (title) parts.push(title);
  return parts.join(" · ");
}
export function missingInputs(project: StudioProject, task: Task): Task[] {
  const inputs = task.dependencies
    .map((id) => {
      const input = project.tasks[id];
      if (!input) throw new Error(`前置任务不存在：${id}`);
      return input;
    })
    .filter((t) => t.delivery !== "approved");
  // A confirmed brief stays intact during supplementary research, but the writer
  // must wait for the updated source report to finish its own review cycle.
  const source = project.tasks.source;
  if (
    task.kind === "script" &&
    source &&
    (source.delivery !== "approved" ||
      project.messages.some(
        (m) =>
          m.taskId === source.id &&
          m.execution &&
          [
            "working",
            "reviewing",
            "revising",
            "continuing",
            "waiting",
            "submitted",
          ].includes(m.execution.status),
      )) &&
    !inputs.some((t) => t.id === source.id)
  )
    inputs.push(source);
  if (task.kind === "assembly") {
    const board = project.tasks[`episode-${task.episode}-storyboard`];
    if (
      board &&
      !board.structure?.complete &&
      !inputs.some((t) => t.id === board.id)
    )
      inputs.push(board);
  }
  return inputs;
}
export function taskStatus(
  project: StudioProject,
  task: Task,
): { label: string; tone: string } {
  if (!task.enabled) return { label: "已暂停", tone: "paused" };
  if (task.delivery === "approved") return { label: "已验收", tone: "done" };
  const execution = project.messages.findLast(
    (message) => message.taskId === task.id && message.execution,
  )?.execution;
  const executionLabels: Record<string, { label: string; tone: string }> = {
    working: { label: "工作中", tone: "active" },
    reviewing: { label: "节点审核中", tone: "active" },
    revising: { label: "修改中", tone: "active" },
    continuing: { label: "等待继续", tone: "waiting" },
    waiting: { label: "等待总控答复", tone: "warning" },
    submitted: { label: "已交总控验收", tone: "warning" },
    returned: { label: "总控退回", tone: "warning" },
    failed: { label: "执行失败", tone: "warning" },
    paused: { label: "已暂停", tone: "paused" },
  };
  if (execution && executionLabels[execution.status])
    return executionLabels[execution.status];
  if (missingInputs(project, task).length)
    return { label: "等待前置", tone: "waiting" };
  if (task.delivery === "returned") return { label: "待修改", tone: "warning" };
  if (
    task.delivery === "reviewed" ||
    (task.delivery === "draft" && (!task.reviewEnabled || isManual(task)))
  )
    return { label: "待总控验收", tone: "warning" };
  if (task.delivery === "draft")
    return { label: "待内部审核", tone: "warning" };
  return { label: isManual(task) ? "待人工制作" : "可开展", tone: "ready" };
}
export function approvedAssets(project: StudioProject, query = ""): Asset[] {
  const q = query.trim().toLocaleLowerCase();
  return project.assets.filter(
    (a) =>
      a.status === "approved" &&
      (!q || `${a.name} ${a.description}`.toLocaleLowerCase().includes(q)),
  );
}
export function nextRecommendation(project: StudioProject): Task | undefined {
  const n = project.representativeEpisode,
    s = project.representativeShot;
  const first = [
    "source",
    "brief",
    "script",
    epId(n),
    `episode-${n}-storyboard`,
    ...["board", "assets", "frames", "video"].map((k) => shotId(n, s, k)),
  ];
  const rest = Object.values(project.tasks)
    .filter((t) => t.episode === n && !first.includes(t.id))
    .map((t) => t.id);
  return [...first, ...rest, ...Object.keys(project.tasks)]
    .map((id) => project.tasks[id])
    .find(
      (t) =>
        t &&
        t.enabled &&
        !t.placeholder &&
        (project.confirmed || ["source", "brief"].includes(t.kind)) &&
        t.delivery !== "approved" &&
        !missingInputs(project, t).length,
    );
}
