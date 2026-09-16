import type { Store } from "./db";
export function migrateCodex(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=20")) return;
    s.db
      .exec(`CREATE TABLE codex_sessions(session_id TEXT PRIMARY KEY REFERENCES sessions(id),thread_id TEXT NOT NULL UNIQUE,tool_hash TEXT NOT NULL,last_message_id TEXT REFERENCES messages(id),created_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES(20,datetime('now'));`);
  });
}
