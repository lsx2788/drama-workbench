import type { Database } from "../database";
import { ensure } from "../errors";

export function rawConversations(
  db: Database,
  projectId: string,
  sessionId?: string,
  before?: number,
) {
  ensure(
    db.one("SELECT id FROM projects WHERE id=?", projectId),
    "找不到剧本",
    "NOT_FOUND",
    404,
  );
  if (!sessionId)
    return {
      sessions: db.all(
        `SELECT s.id,s.scope,s.role,s.thread_id AS threadId,t.title,
    (SELECT COUNT(*) FROM raw_events e WHERE e.session_id=s.id) AS count
    FROM sessions s LEFT JOIN tasks t ON t.project_id=s.project_id AND t.id=s.scope
    WHERE s.project_id=? ORDER BY s.rowid`,
        projectId,
      ),
    };
  ensure(
    db.one(
      "SELECT id FROM sessions WHERE id=? AND project_id=?",
      sessionId,
      projectId,
    ),
    "会话不属于此剧本",
    "NOT_FOUND",
    404,
  );
  const rows = db.all<{ seq: number }>(
    `SELECT e.*,r.thread_id,r.turn_id FROM raw_events e JOIN runs r ON r.id=e.run_id
    WHERE e.project_id=? AND e.session_id=? AND e.seq<? ORDER BY e.seq DESC LIMIT 50`,
    projectId,
    sessionId,
    before ?? Number.MAX_SAFE_INTEGER,
  );
  return {
    events: rows.reverse(),
    before: rows.length === 50 ? rows[0].seq : null,
  };
}
