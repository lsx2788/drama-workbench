import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { storedDimensions } from "./image-metadata";
import type { Actor } from "./contracts";
import type { LibraryImage } from "../domain/types";
import { ensure } from "./errors";

type Row = Record<string, any>;

/** Original files and review history remain immutable; trash only changes availability. */
export function imageInventory(
  db: Database,
  projectId: string,
): LibraryImage[] {
  return db
    .all<Row>(
      `SELECT f.*,t.title,g.name AS image_name,g.revision AS generated_revision,
    (SELECT MAX(revision) FROM output_files o WHERE o.file_id=f.id) AS revision,
    EXISTS(SELECT 1 FROM output_files o WHERE o.file_id=f.id AND o.revision=
      (SELECT MAX(x.revision) FROM outputs x WHERE x.project_id=o.project_id AND x.task_id=o.task_id)) AS current,
    json_extract(s.layers,'$.rulesVersion') AS rules_version,
    b.reason,b.actor,b.trashed_at
    FROM files f JOIN tasks t ON t.project_id=f.project_id AND t.id=f.task_id
    LEFT JOIN image_generations g ON g.file_id=f.id
    LEFT JOIN run_prompt_snapshots s ON s.run_id=g.run_id
    LEFT JOIN image_trash b ON b.file_id=f.id
    WHERE f.project_id=? AND f.scope='output' AND f.mime LIKE 'image/%'
    ORDER BY f.created_at DESC,f.rowid DESC`,
      projectId,
    )
    .map((r) => ({
      file: {
        ...storedDimensions(db, r.id),
        id: r.id,
        name: r.name,
        size: r.size,
        type: r.mime,
        url: `/api/files/${r.id}`,
        trashed: !!r.trashed_at,
      },
      taskId: r.task_id,
      name: r.image_name || r.title,
      revision: r.generated_revision ?? r.revision ?? 0,
      current: !!r.current,
      createdAt: r.created_at,
      rulesVersion: r.rules_version ?? undefined,
      trash: r.trashed_at
        ? { reason: r.reason, actor: r.actor, time: r.trashed_at }
        : undefined,
    }));
}

/** Prevent removing a live input. Historical provenance remains visible after recycling. */
export function imageUsage(db: Database, p: string, fileId: string): string[] {
  const file = db.one<Row>(
    "SELECT * FROM files WHERE project_id=? AND id=?",
    p,
    fileId,
  );
  ensure(file, "找不到当前剧本的图片", "NOT_FOUND", 404);
  const reasons = new Set<string>();
  for (const d of db.all<Row>(
    `SELECT d.reference_files,t.title FROM node_delegations d
     JOIN node_jobs j ON j.id=d.job_id JOIN tasks t ON t.project_id=d.project_id AND t.id=d.task_id
     WHERE d.project_id=? AND j.status IN ('working','reviewing','revising','waiting','continuing','submitted')
     AND d.rowid=(SELECT MAX(n.rowid) FROM node_delegations n WHERE n.job_id=d.job_id)`,
    p,
  )) {
    if (
      JSON.parse(d.reference_files).some(
        (r: { file: { id: string } }) => r.file.id === fileId,
      )
    )
      reasons.add(`执行中的任务参考：${d.title}`);
  }
  for (const g of db.all<Row>(
    "SELECT name,reference_ids FROM image_generations WHERE project_id=? AND status='generating'",
    p,
  )) {
    if (JSON.parse(g.reference_ids).includes(fileId))
      reasons.add(`正在生成的图片：${g.name}`);
  }
  const attachedCurrent = db.one(
    `SELECT file_id FROM output_files o WHERE project_id=? AND task_id=? AND file_id=?
    AND revision=(SELECT MAX(revision) FROM outputs WHERE project_id=? AND task_id=?)`,
    p,
    file.task_id,
    fileId,
    p,
    file.task_id,
  );
  if (attachedCurrent) {
    if (
      db.one(
        `SELECT id FROM node_jobs WHERE project_id=? AND task_id=?
      AND status IN ('working','reviewing','revising','waiting','continuing','submitted')`,
        p,
        file.task_id,
      )
    )
      reasons.add("所属图片任务仍在处理中或待验收");
    for (const d of db.all<Row>(
      `SELECT t.title FROM dependencies d JOIN tasks t
      ON t.project_id=d.project_id AND t.id=d.task_id WHERE d.project_id=? AND d.input_id=?`,
      p,
      file.task_id,
    ))
      reasons.add(`任务依赖：${d.title}`);
  }
  const assets = db.all<Row>(
    `SELECT a.id FROM assets a JOIN output_files o ON o.project_id=a.project_id
    AND o.task_id=a.task_id AND o.revision=a.output_revision WHERE a.project_id=? AND o.file_id=?
    AND a.version=(SELECT MAX(b.version) FROM assets b WHERE b.project_id=a.project_id AND b.id=a.id)`,
    p,
    fileId,
  );
  for (const a of assets) {
    for (const o of db.all<Row>(
      `SELECT o.asset_ids,t.title FROM outputs o JOIN tasks t ON t.project_id=o.project_id AND t.id=o.task_id
      WHERE o.project_id=? AND o.task_id<>? AND o.revision=(SELECT MAX(x.revision) FROM outputs x WHERE x.project_id=o.project_id AND x.task_id=o.task_id)`,
      p,
      file.task_id,
    )) {
      if (JSON.parse(o.asset_ids).includes(a.id))
        reasons.add(`资产引用：${o.title}`);
    }
  }
  return [...reasons];
}

export function recycleImage(
  db: Database,
  p: string,
  fileId: string,
  action: "trash" | "restore",
  reason: string,
  actor: Actor,
) {
  return db.transaction(() => {
    const file = db.one<Row>(
      "SELECT * FROM files WHERE project_id=? AND id=?",
      p,
      fileId,
    );
    ensure(
      file?.scope === "output" && file.mime.startsWith("image/"),
      "只能管理当前剧本的产出图片，原始上传资料不进入此垃圾篓",
    );
    const allowed =
      actor.role === "human" ||
      actor.role === "coordinator" ||
      (!!actor.taskId &&
        actor.taskId === file.task_id &&
        !!db.one(
          "SELECT id FROM tasks WHERE project_id=? AND id=? AND kind IN ('assets','frames')",
          p,
          actor.taskId,
        ));
    ensure(
      allowed,
      "只能管理自己节点的图片；跨节点整理交给总控",
      "FORBIDDEN",
      403,
    );
    ensure(
      reason.trim().length > 0 && reason.length <= 4000,
      "请填写图片保留或移入垃圾篓的理由",
    );
    const existing = db.one(
      "SELECT file_id FROM image_trash WHERE file_id=?",
      fileId,
    );
    if ((action === "trash") === !!existing)
      return { changed: false, status: action };
    if (action === "trash") {
      const usage = imageUsage(db, p, fileId);
      ensure(
        !usage.length,
        `图片仍在使用，暂不能移入垃圾篓：${usage.join("；")}`,
        "CONFLICT",
        409,
      );
      db.run(
        "INSERT INTO image_trash VALUES(?,?,?,?,?)",
        fileId,
        reason.trim(),
        actor.role,
        actor.taskId ?? null,
        new Date().toISOString(),
      );
    } else db.run("DELETE FROM image_trash WHERE file_id=?", fileId);
    const revision =
      db.one<{ revision: number }>(
        "SELECT MAX(revision) AS revision FROM output_files WHERE file_id=?",
        fileId,
      )?.revision ?? 0;
    db.run(
      "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
      randomUUID(),
      p,
      file.task_id,
      action === "trash" ? "image-trash" : "image-restore",
      revision,
      actor.role,
      `${action === "trash" ? "图片移入垃圾篓" : "图片已恢复"}：${file.name}（${fileId}）\n原因：${reason.trim()}`,
      new Date().toISOString(),
    );
    db.run("UPDATE projects SET version=version+1 WHERE id=?", p);
    return { changed: true, status: action };
  });
}
