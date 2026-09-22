import { randomUUID } from "node:crypto";
import type { Database } from "../database";

/** A terminal parent cannot own a live lock. Never infer interruption from age. */
export function recoverOrphanedNodes(db: Database) {
  return db.transaction(() => {
    const jobs = db.all<{
      id: string;
      project_id: string;
      task_id: string;
      revision: number;
    }>(`
      SELECT j.id,j.project_id,j.task_id,COALESCE((SELECT MAX(o.revision) FROM outputs o WHERE o.project_id=j.project_id AND o.task_id=j.task_id),0) AS revision FROM node_jobs j
      JOIN runs r ON r.id=j.parent_run
      JOIN tasks t ON t.project_id=j.project_id AND t.id=j.task_id
      WHERE j.status IN ('working','reviewing','revising','continuing')
        AND r.status IN ('completed','failed','interrupted')
        AND NOT EXISTS (SELECT 1 FROM runs live WHERE live.project_id=j.project_id AND live.status IN ('queued','running'))
        AND NOT EXISTS (SELECT 1 FROM image_generations g WHERE g.project_id=j.project_id AND g.status='generating')
    `);
    for (const job of jobs) {
      const waiting = !!db.one(
        "SELECT id FROM node_questions WHERE job_id=? AND status='escalated'",
        job.id,
      );
      const reason = waiting
        ? "执行已中断，节点问题仍待总控答复。"
        : "执行已中断，产出与审核记录已保留。总控可继续审核或按最新意见返修。";
      const now = new Date().toISOString();
      db.run(
        "UPDATE node_jobs SET status=?,error=?,updated_at=? WHERE id=?",
        waiting ? "waiting" : "paused",
        reason,
        now,
        job.id,
      );
      db.run(
        "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
        randomUUID(),
        job.project_id,
        job.task_id,
        "recover-execution",
        job.revision,
        "system",
        reason,
        now,
      );
      db.run(
        "UPDATE projects SET version=version+1 WHERE id=?",
        job.project_id,
      );
    }
    return jobs.map((job) => job.id);
  });
}
