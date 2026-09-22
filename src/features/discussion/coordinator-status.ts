import type { StudioProject } from "@/domain";

export function coordinatorStatus(project: StudioProject) {
  if (["queued", "running"].includes(project.run?.status ?? ""))
    return {
      state: "working",
      label: "处理中",
      detail: "总控正在处理，结果会自动更新",
    };
  if (
    ["failed", "interrupted", "cancelled"].includes(project.run?.status ?? "")
  )
    return {
      state: "paused",
      label: "已暂停",
      detail: project.run?.error || "本轮已停止，请查看聊天中的说明",
    };
  if (project.messages.some((m) => m.confirmation?.status === "pending"))
    return {
      state: "waiting",
      label: "等待回复",
      detail: "有待确认的问题，回复或跳过后继续",
    };
  return { state: "idle", label: "空闲", detail: "当前没有正在执行的总控任务" };
}
