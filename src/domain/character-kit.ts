import type { StudioProject } from "./types";
import { isCharacterBasis } from "./character-basis";

export const characterKitPurposes = [
  "角色三视图",
  "面部特写",
  "服装图",
  "穿衣组合",
] as const;

/** Check only characters used by this branch; unrelated roles must not block it. */
export function characterKits(
  project: StudioProject,
  taskId: string,
  availableImages: ReadonlySet<string>,
  referenceTasks: string[] = [],
) {
  const visited = new Set<string>(),
    bases = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const task = project.tasks[id];
    if (!task) return;
    // An image's references record how it was made, not additional cast members.
    // In particular a replacement sample may reference the old sample it supersedes.
    if (isCharacterBasis(task.imageSpec?.purpose)) {
      bases.add(id);
      return;
    }
    if (task.imageSpec?.basisTaskId) {
      bases.add(task.imageSpec.basisTaskId);
      return;
    }
    for (const dependency of task.dependencies) visit(dependency);
    for (const assetId of task.assetIds) {
      const source = project.assets.find((a) => a.id === assetId)?.taskId;
      if (source) visit(source);
    }
  }
  visit(taskId);
  referenceTasks.forEach(visit);
  return [...bases].map((basisTaskId) => {
    const basis = project.tasks[basisTaskId];
    const items = characterKitPurposes.map((purpose) => ({
      purpose,
      taskIds: Object.values(project.tasks)
        .filter(
          (task) =>
            task.imageSpec?.basisTaskId === basisTaskId &&
            task.imageSpec.purpose === purpose &&
            task.delivery === "approved" &&
            !task.retirement &&
            availableImages.has(task.id),
        )
        .map((task) => task.id),
    }));
    const missing: string[] = items
      .filter((item) => !item.taskIds.length)
      .map((item) => item.purpose);
    if (
      !basis ||
      basis.delivery !== "approved" ||
      basis.retirement ||
      !availableImages.has(basisTaskId)
    )
      missing.unshift("已验收角色定稿基准");
    return {
      basisTaskId,
      name: basis?.assetName || basis?.title || basisTaskId,
      items,
      missing,
      ready: missing.length === 0,
    };
  });
}
