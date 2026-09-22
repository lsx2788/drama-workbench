import type { Asset, MediaFile, StudioProject, Task } from "./types";
import { characterKits } from "./character-kit";

export type ResourceShot = {
  board: Task;
  assetTask?: Task;
  frames?: Task;
  assets: Asset[];
  files: MediaFile[];
  issues: string[];
  warnings: string[];
};
const accepted = (task?: Task) =>
  !!task &&
  task.delivery === "approved" &&
  !task.placeholder &&
  !task.retirement;
const imageFiles = (files: MediaFile[]) =>
  files.filter(
    (file) => !!file.id && !file.trashed && file.type.startsWith("image/"),
  );

/** Export readiness is independent of the video workflow and optional frame generation. */
export function resourceShots(
  project: StudioProject,
  files: Record<string, MediaFile[]>,
): ResourceShot[] {
  return Object.values(project.tasks)
    .filter(
      (task) =>
        task.kind === "board" &&
        !task.placeholder &&
        !!task.episode &&
        !!task.shot,
    )
    .sort((a, b) => a.episode! - b.episode! || a.shot! - b.shot!)
    .map((board) => {
      const sameShot = (task: Task) =>
        task.episode === board.episode && task.shot === board.shot;
      const assetTask = Object.values(project.tasks).find(
        (task) => task.kind === "assets" && sameShot(task),
      );
      const frameTask = Object.values(project.tasks).find(
        (task) => task.kind === "frames" && sameShot(task),
      );
      const issues: string[] = [],
        warnings: string[] = [];
      if (!accepted(project.tasks.brief)) issues.push("制作需求尚未验收");
      if (!accepted(board) || !board.text.trim()) issues.push("分镜词尚未验收");
      if (!accepted(assetTask)) issues.push("基础资产包尚未验收");
      if (assetTask && !assetTask.dependencies.includes(board.id))
        issues.push("基础资产包未关联本镜头分镜");
      const frames = accepted(frameTask) ? frameTask : undefined;
      const ids = new Set([
        ...(accepted(assetTask) ? assetTask!.assetIds : []),
        ...(frames?.assetIds ?? []),
      ]);
      const assets: Asset[] = [];
      if (assetTask) {
        const available = new Set(
          project.assets
            .filter((a) => a.taskId && imageFiles(a.files ?? []).length)
            .map((a) => a.taskId!),
        );
        for (const kit of characterKits(project, assetTask.id, available)) {
          if (!kit.ready)
            issues.push(`${kit.name} 规范图缺少：${kit.missing.join("、")}`);
          for (const item of kit.items)
            for (const taskId of item.taskIds)
              for (const asset of project.assets.filter(
                (a) => a.taskId === taskId,
              ))
                ids.add(asset.id);
        }
      }
      for (const id of ids) {
        const asset = project.assets.find(
          (item) => item.id === id && item.status === "approved",
        );
        if (!asset || !imageFiles(asset.files ?? []).length) {
          issues.push(`关联资产缺少已验收图片：${asset?.name ?? id}`);
        } else assets.push(asset);
      }
      const ownFiles = accepted(assetTask)
        ? imageFiles(files[`${project.id}/${assetTask!.id}`] ?? [])
        : [];
      if (accepted(assetTask) && !ownFiles.length && !assets.length)
        issues.push("基础资产包缺少实际图片，文字设定不能代替图片");
      const frameFiles = frames
        ? imageFiles(files[`${project.id}/${frames.id}`] ?? [])
        : [];
      if (!frameFiles.length)
        warnings.push("未含已验收镜头画面，可使用分镜词和基础资产在外部制作");
      const allFiles = [
        ...ownFiles,
        ...assets.flatMap((asset) => imageFiles(asset.files ?? [])),
        ...frameFiles,
      ];
      return {
        board,
        assetTask,
        frames,
        assets,
        files: [...new Map(allFiles.map((file) => [file.id!, file])).values()],
        issues,
        warnings,
      };
    });
}
