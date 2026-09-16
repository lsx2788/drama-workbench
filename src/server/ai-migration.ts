import type { Store } from "./db";

export function migrateAiRuntime(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=19")) return;
    s.db.exec(`
      CREATE TABLE chat_attachments(message_id TEXT NOT NULL REFERENCES messages(id),story_id TEXT NOT NULL REFERENCES story_sources(id),position INTEGER NOT NULL,PRIMARY KEY(message_id,story_id));
      CREATE TABLE ai_turns(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),session_id TEXT NOT NULL REFERENCES sessions(id),message_id TEXT NOT NULL REFERENCES messages(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','interrupted')),owner TEXT NOT NULL,config_json TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,finished_at TEXT,UNIQUE(project_id,request_key));
      CREATE UNIQUE INDEX ai_session_active ON ai_turns(session_id) WHERE status IN ('queued','running');
      CREATE TABLE ai_calls(id TEXT PRIMARY KEY,turn_id TEXT NOT NULL REFERENCES ai_turns(id),session_id TEXT NOT NULL REFERENCES sessions(id),input_json TEXT NOT NULL,output_json TEXT,response_id TEXT,created_at TEXT NOT NULL);
      CREATE TABLE ai_tool_events(id TEXT PRIMARY KEY,turn_id TEXT NOT NULL REFERENCES ai_turns(id),session_id TEXT NOT NULL REFERENCES sessions(id),name TEXT NOT NULL,arguments_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE ai_images(message_id TEXT NOT NULL REFERENCES messages(id),file_id TEXT NOT NULL REFERENCES files(id),call_id TEXT NOT NULL,PRIMARY KEY(message_id,file_id));
      INSERT INTO schema_migrations VALUES(19,datetime('now'));
    `);
  });
}
