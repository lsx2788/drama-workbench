import { randomUUID } from "node:crypto";
import type { Actor } from "./contracts";
import { ensure } from "./errors";
import { imageUsage, recycleImage } from "./image-trash";
import type { StudioService } from "./studio-service";

/** Retire only abandoned standalone assets. Review history and original bytes are never changed. */
export function recyclePausedAsset(
  service: StudioService,
  projectId: string,
  taskId: string,
  revision: number,
  action: "trash" | "restore",
  reason: string,
  actor: Actor,
) {
  const db = service.db;
  return db.transaction(() => {
    ensure(
      actor.role === "coordinator" || actor.role === "human",
      "只有总控可以清理或恢复暂停资产",
      "FORBIDDEN",
      403,
    );
    ensure(
      reason.trim().length > 0 && reason.length <= 4000,
      "请说明清理或恢复的原因",
    );
    const task = service.project(projectId).tasks[taskId];
    ensure(task, "找不到当前剧本的资产任务", "NOT_FOUND", 404);
    ensure(
      task.kind === "assets" &&
        task.episode === undefined &&
        task.shot === undefined,
      "只能清理独立资产，不能清理流程中的基础资产包",
    );
    ensure(
      task.revision === revision,
      "产出版本已变化，请重新查询",
      "CONFLICT",
      409,
    );
    const previous = db.one<{ file_ids: string; reason: string }>(
      "SELECT file_ids,reason FROM retired_assets WHERE project_id=? AND task_id=?",
      projectId,
      taskId,
    );
    if ((action === "trash") === !!previous)
      return { changed: false, status: previous ? "retired" : "paused" };
    if (action === "trash") {
      ensure(!task.enabled, "请先暂停制作，再判断是否清理");
      ensure(
        !db.one(
          "SELECT id FROM reviews WHERE project_id=? AND task_id=? AND stage='acceptance' AND decision='pass'",
          projectId,
          taskId,
        ),
        "此任务有已验收版本，不能作为未定稿资产清理",
      );
      ensure(
        !db.one(
          "SELECT id FROM assets WHERE project_id=? AND task_id=?",
          projectId,
          taskId,
        ),
        "此任务已进入正式资产库，不能作为未定稿资产清理",
      );
      ensure(
        !db.one(
          "SELECT id FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('working','reviewing','revising','waiting','continuing','submitted')",
          projectId,
          taskId,
        ),
        "任务仍在处理中或待验收，暂不能清理",
      );
      ensure(
        !db.one(
          "SELECT id FROM image_generations WHERE project_id=? AND task_id=? AND status='generating'",
          projectId,
          taskId,
        ),
        "图片仍在生成，暂不能清理",
      );
      ensure(
        !db.one(
          "SELECT task_id FROM dependencies WHERE project_id=? AND input_id=?",
          projectId,
          taskId,
        ),
        "仍有任务依赖此资产，暂不能清理",
      );
      ensure(
        !db.one(
          "SELECT task_id FROM image_task_specs WHERE project_id=? AND basis_task_id=?",
          projectId,
          taskId,
        ),
        "此资产仍是其他图片的角色基准，暂不能清理",
      );
      const files = db.all<{ id: string }>(
        "SELECT id FROM files WHERE project_id=? AND task_id=? AND scope='output' AND mime LIKE 'image/%' AND NOT EXISTS(SELECT 1 FROM image_trash b WHERE b.file_id=files.id)",
        projectId,
        taskId,
      );
      for (const file of files) {
        const usage = imageUsage(db, projectId, file.id);
        ensure(
          !usage.length,
          `图片仍在使用，暂不能清理：${usage.join("；")}`,
          "CONFLICT",
          409,
        );
      }
      for (const file of files)
        recycleImage(db, projectId, file.id, "trash", reason, actor);
      db.run(
        "INSERT INTO retired_assets VALUES(?,?,?,?,?,?,?)",
        projectId,
        taskId,
        revision,
        reason.trim(),
        actor.role,
        new Date().toISOString(),
        JSON.stringify(files.map((file) => file.id)),
      );
    } else {
      db.run(
        "DELETE FROM retired_assets WHERE project_id=? AND task_id=?",
        projectId,
        taskId,
      );
      for (const fileId of JSON.parse(previous!.file_ids) as string[]) {
        const trash = db.one<{ reason: string }>(
          "SELECT reason FROM image_trash WHERE file_id=?",
          fileId,
        );
        // Do not restore files that were already in trash before retirement or subsequently reclassified.
        if (trash?.reason === previous!.reason)
          recycleImage(db, projectId, fileId, "restore", reason, actor);
      }
    }
    db.run(
      "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
      randomUUID(),
      projectId,
      taskId,
      action === "trash" ? "asset-retire" : "asset-restore",
      revision,
      actor.role,
      `${action === "trash" ? "清理暂停资产" : "恢复资产（仍暂停、未验收）"}：${reason.trim()}`,
      new Date().toISOString(),
    );
    db.run("UPDATE projects SET version=version+1 WHERE id=?", projectId);
    return {
      changed: true,
      status: action === "trash" ? "retired" : "paused",
      taskId,
    };
  });
}
