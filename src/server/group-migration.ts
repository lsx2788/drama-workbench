import type { Store } from "./db";
export function migrateGroups(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=21")) return;
    s.db.exec(`
      CREATE TABLE chat_groups(session_id TEXT PRIMARY KEY REFERENCES sessions(id),project_id TEXT NOT NULL REFERENCES projects(id),created_at TEXT NOT NULL);
      CREATE TABLE group_members(group_id TEXT NOT NULL REFERENCES chat_groups(session_id),session_id TEXT NOT NULL REFERENCES sessions(id),joined_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),PRIMARY KEY(group_id,session_id));
      CREATE TABLE group_messages(message_id TEXT PRIMARY KEY REFERENCES messages(id),group_id TEXT NOT NULL REFERENCES chat_groups(session_id),reply_to_id TEXT REFERENCES messages(id));
      CREATE INDEX group_timeline ON group_messages(group_id);
      CREATE TABLE group_deliveries(message_id TEXT NOT NULL REFERENCES group_messages(message_id),session_id TEXT NOT NULL REFERENCES sessions(id),mentioned INTEGER NOT NULL DEFAULT 0,prompt_version INTEGER,PRIMARY KEY(message_id,session_id));
      CREATE INDEX group_inbox ON group_deliveries(session_id,message_id);
      CREATE TABLE group_silences(id TEXT PRIMARY KEY,turn_id TEXT NOT NULL REFERENCES ai_turns(id),session_id TEXT NOT NULL REFERENCES sessions(id),trigger_message_id TEXT NOT NULL REFERENCES messages(id),created_at TEXT NOT NULL);
      INSERT INTO chat_groups SELECT ss.id,w.project_id,ss.created_at FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE n.node_type='coordinator';
      INSERT INTO group_members(group_id,session_id,joined_at) SELECT session_id,session_id,created_at FROM chat_groups;
      INSERT INTO group_messages SELECT m.id,g.session_id,CASE WHEN q.session_id=m.session_id THEN m.quote_id ELSE NULL END FROM messages m JOIN chat_groups g ON g.session_id=m.session_id LEFT JOIN messages q ON q.id=m.quote_id;
      INSERT INTO group_deliveries SELECT gm.message_id,gm.group_id,0,pv.version FROM group_messages gm LEFT JOIN message_prompt_versions pv ON pv.message_id=gm.message_id;
      INSERT INTO schema_migrations VALUES(21,datetime('now'));
    `);
  });
}
