import type { Store } from "./db";

export function migrateDynamicCollaboration(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=22")) return;
    s.db.exec(`
      CREATE TABLE preparation_setups_v22(project_id TEXT PRIMARY KEY REFERENCES projects(id),workflow_id TEXT NOT NULL REFERENCES workflows(id),coordinator_node_id TEXT NOT NULL REFERENCES nodes(id),analysis_node_id TEXT REFERENCES nodes(id),writing_node_id TEXT REFERENCES nodes(id));
      INSERT INTO preparation_setups_v22 SELECT * FROM preparation_setups;
      DROP TABLE preparation_setups;
      ALTER TABLE preparation_setups_v22 RENAME TO preparation_setups;
      CREATE TABLE group_members_v22(group_id TEXT NOT NULL REFERENCES chat_groups(session_id),session_id TEXT NOT NULL REFERENCES sessions(id),joined_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','active','paused')),PRIMARY KEY(group_id,session_id));
      INSERT INTO group_members_v22 SELECT * FROM group_members;
      DROP TABLE group_members;
      ALTER TABLE group_members_v22 RENAME TO group_members;
      UPDATE group_members SET status='available' WHERE status='active' AND session_id<>group_id
        AND NOT EXISTS(SELECT 1 FROM ai_calls c WHERE c.session_id=group_members.session_id)
        AND NOT EXISTS(SELECT 1 FROM messages m JOIN sessions ss ON ss.id=group_members.session_id WHERE m.session_id=ss.id OR m.sender_id=ss.agent_id)
        AND NOT EXISTS(SELECT 1 FROM sessions ss WHERE ss.id=group_members.session_id AND ss.external_session_id IS NOT NULL);
      CREATE TABLE message_context(message_id TEXT PRIMARY KEY REFERENCES messages(id),references_json TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES(22,datetime('now'));
    `);
  });
}
