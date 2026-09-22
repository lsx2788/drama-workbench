import type { Task } from "@/domain";
export type TaskDraft = {
  text: string;
  reason: string;
  assetIds: string[];
  assetName: string;
  assetCategory: string;
};
export function draftMatches(draft: TaskDraft, task: Task) {
  return (
    draft.text === task.text &&
    (task.kind !== "assets" ||
      (draft.reason === task.reuseReason &&
        draft.assetName === (task.assetName ?? "") &&
        draft.assetCategory === (task.assetCategory ?? "人物") &&
        JSON.stringify(draft.assetIds) === JSON.stringify(task.assetIds)))
  );
}
