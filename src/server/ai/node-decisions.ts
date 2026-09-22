import type { Database } from "../database";

/** Preserve the actual human reply, not merely an answered flag or a coordinator paraphrase. */
export function userConfirmations(db: Database, projectId: string) {
  return db
    .all<Record<string, any>>(
      `SELECT m.id,m.text,d.answered_by AS answeredBy,
      CASE WHEN s.message_id IS NOT NULL THEN 'skipped' WHEN d.answered_by IS NOT NULL THEN 'answered' ELSE 'pending' END AS status,
      a.text AS answerText,a.created_at AS answeredAt
     FROM messages m JOIN message_details d ON d.message_id=m.id
     LEFT JOIN messages a ON a.id=d.answered_by AND a.project_id=m.project_id AND a.role='human'
     LEFT JOIN confirmation_skips s ON s.message_id=m.id
     WHERE m.project_id=? AND d.requires_reply=1 ORDER BY m.seq DESC LIMIT 30`,
      projectId,
    )
    .reverse();
}

export function nodeDecisions(
  db: Database,
  projectId: string,
  taskId: string,
  jobId?: string,
) {
  const answers = db
    .all<Record<string, any>>(
      `SELECT q.id,q.question,q.answer,q.status,q.created_at AS createdAt,j.id AS jobId
     FROM node_questions q JOIN node_jobs j ON j.id=q.job_id
     WHERE j.project_id=? AND j.task_id=? AND q.status='answered'
       AND (? IS NULL OR j.id=?) ORDER BY q.rowid DESC LIMIT 12`,
      projectId,
      taskId,
      jobId ?? null,
      jobId ?? null,
    )
    .reverse();
  return {
    answers,
    // Human confirmations remain evidence of their actual wording, never automatic consent.
    confirmations: answers.length
      ? userConfirmations(db, projectId).slice(-10)
      : [],
  };
}
