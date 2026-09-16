import type { Store } from "./db";
import { assert, audit, DomainError, now, projectExists } from "./common";

export function migrateProjectTrash(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=24")) return;
    s.db.exec(`
      CREATE TABLE project_trash(project_id TEXT PRIMARY KEY REFERENCES projects(id), deleted_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES(24,datetime('now'));
    `);
  });
}
export function assertProjectNotTrashed(s: Store, p: string) {
  if (s.one("SELECT 1 FROM project_trash WHERE project_id=?", p))
    throw new DomainError("PROJECT_TRASHED", "剧本已移入垃圾箱，请先恢复", 409);
}
export function listProjectTrash(s: Store) {
  return s.all(
    "SELECT p.*,t.deleted_at FROM project_trash t JOIN projects p ON p.id=t.project_id ORDER BY t.deleted_at DESC",
  );
}
export function trashProject(s: Store, p: string) {
  projectExists(s, p);
  return s.transaction(() => {
    if (!s.one("SELECT 1 FROM project_trash WHERE project_id=?", p)) {
      assert(
        !s.one(
          "SELECT 1 FROM ai_turns WHERE project_id=? AND status IN ('queued','running')",
          p,
        ),
        "AI 正在处理这个剧本，请等本次回复结束后再删除",
      );
      s.run("INSERT INTO project_trash VALUES(?,?)", p, now());
      audit(s, p, "project.trashed", p);
    }
    return { projectId: p, trashed: true };
  });
}
export function restoreProject(s: Store, p: string) {
  projectExists(s, p);
  return s.transaction(() => {
    if (s.one("SELECT 1 FROM project_trash WHERE project_id=?", p)) {
      s.run("DELETE FROM project_trash WHERE project_id=?", p);
      // Restored scripts return to the visible directory, including legacy archives.
      s.run("DELETE FROM project_archives WHERE project_id=?", p);
      audit(s, p, "project.trash_restored", p);
    }
    return { projectId: p, trashed: false };
  });
}
