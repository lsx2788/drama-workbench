import type { AgentKey } from "@/domain/agent-config";
import type { StudioProject, TaskKind } from "@/domain";

export const memberStages: {
  id: string;
  title: string;
  purpose: string;
  producer: AgentKey;
  kinds: TaskKind[];
}[] = [
  {
    id: "source",
    title: "原作理解",
    purpose: "事实、人物关系与改编依据",
    producer: "source",
    kinds: ["source"],
  },
  {
    id: "script",
    title: "整体剧本与分集",
    purpose: "改编取舍、合理分集与关键剧集",
    producer: "script",
    kinds: ["script"],
  },
  {
    id: "episode",
    title: "单集剧本",
    purpose: "本集场景、行动与对白",
    producer: "episode",
    kinds: ["episode"],
  },
  {
    id: "board",
    title: "分镜设计",
    purpose: "镜头、连续性与关键镜头",
    producer: "board",
    kinds: ["storyboard", "board"],
  },
  {
    id: "assets",
    title: "基础资产",
    purpose: "人物、服装、场景与道具图片",
    producer: "assets",
    kinds: ["assets"],
  },
  {
    id: "frames",
    title: "镜头画面",
    purpose: "首尾帧与关键动作画面",
    producer: "frames",
    kinds: ["frames"],
  },
];
export function stageTasks(project: StudioProject, kinds: TaskKind[]) {
  return Object.values(project.tasks)
    .filter(
      (task) =>
        kinds.includes(task.kind) && !task.placeholder && !task.retirement,
    )
    .sort(
      (a, b) =>
        (a.episode ?? 0) - (b.episode ?? 0) ||
        (a.shot ?? 0) - (b.shot ?? 0) ||
        a.title.localeCompare(b.title, "zh-CN"),
    );
}
export function latestTaskExecutions(project: StudioProject) {
  const latest = new Map<
    string,
    NonNullable<StudioProject["messages"][number]["execution"]>
  >();
  for (const m of project.messages)
    if (m.taskId && m.execution) latest.set(m.taskId, m.execution);
  return latest;
}

export function taskActivityGroups(project: StudioProject) {
  const latest = new Map<string, StudioProject["messages"][number]>();
  for (const message of project.messages)
    if (message.taskId && message.execution)
      latest.set(message.taskId, message);
  const current = [...latest.values()].reverse().filter((message) => {
    const task = project.tasks[message.taskId!];
    return task && !task.retirement && task.delivery !== "approved";
  });
  return [
    {
      title: "正在执行",
      rows: current.filter((m) =>
        ["working", "reviewing", "revising"].includes(m.execution!.status),
      ),
    },
    {
      title: "等待处理",
      rows: current.filter((m) =>
        [
          "continuing",
          "waiting",
          "submitted",
          "paused",
          "failed",
          "returned",
        ].includes(m.execution!.status),
      ),
    },
  ].filter((group) => group.rows.length);
}
