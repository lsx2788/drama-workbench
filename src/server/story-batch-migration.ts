import type { Store } from "./db";

/** Preserve existing handoffs while allowing several sources on one message. */
export function migrateStoryBatches(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=11")) return;
    s.db.exec(`
      CREATE TABLE story_discussions_next (
        story_id TEXT PRIMARY KEY REFERENCES story_sources(id),
        message_id TEXT NOT NULL REFERENCES messages(id),
        created_at TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO story_discussions_next(story_id,message_id,created_at)
        SELECT story_id,message_id,created_at FROM story_discussions;
      DROP TABLE story_discussions;
      ALTER TABLE story_discussions_next RENAME TO story_discussions;
      CREATE INDEX discussions_message ON story_discussions(message_id,position);
      CREATE TABLE story_import_batches (
        import_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id)
      );
      CREATE TABLE story_import_batch_files (
        import_key TEXT NOT NULL REFERENCES story_import_batches(import_key),
        story_id TEXT NOT NULL UNIQUE REFERENCES story_sources(id),
        position INTEGER NOT NULL,
        PRIMARY KEY(import_key,position)
      );
      INSERT INTO schema_migrations VALUES(11,datetime('now'));
    `);
  });
}
