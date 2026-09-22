import type { Asset, Task } from "./types";

export type OutputState = "approved" | "draft" | "paused" | "retired";

/** Pausing production does not revoke an existing acceptance. */
export function taskOutputState(task: Task): OutputState {
  if (task.delivery === "approved") return "approved";
  if (task.retirement) return "retired";
  return task.enabled ? "draft" : "paused";
}

export function assetOutputState(
  asset: Asset,
  tasks: Record<string, Task>,
): OutputState {
  if (asset.status === "approved") return "approved";
  const task = asset.taskId ? tasks[asset.taskId] : undefined;
  const state = task ? taskOutputState(task) : "draft";
  return state === "paused" || state === "retired" ? state : "draft";
}

export const outputStateLabels = {
  approved: "已通过",
  draft: "讨论中",
  paused: "已暂停",
  retired: "已清理",
};
export const outputStateTones = {
  approved: "done",
  draft: "warning",
  paused: "paused",
  retired: "paused",
};

/** Candidate files belong to image records, never the reusable character library. */
export function approvedBasisAssets(assets: Asset[]): Asset[] {
  return assets.filter(
    (asset) => asset.category !== "镜头画面" && asset.status === "approved",
  );
}
