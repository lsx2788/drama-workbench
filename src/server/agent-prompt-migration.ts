import type { Store } from "./db";

export function migrateAgentPrompts(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=12")) return;
    s.db.exec(`
      CREATE TABLE agent_prompt_versions (
        agent_id TEXT NOT NULL REFERENCES agents(id),
        version INTEGER NOT NULL CHECK(version>0),
        instructions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('created','updated','baseline')),
        PRIMARY KEY(agent_id,version)
      );
      INSERT INTO agent_prompt_versions
        SELECT id,config_version,instructions,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'baseline' FROM agents;
      CREATE TABLE message_prompt_versions (
        message_id TEXT PRIMARY KEY REFERENCES messages(id),
        agent_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        FOREIGN KEY(agent_id,version) REFERENCES agent_prompt_versions(agent_id,version)
      );
      CREATE TRIGGER prompt_version_no_update BEFORE UPDATE ON agent_prompt_versions
        BEGIN SELECT RAISE(ABORT,'Prompt versions are immutable'); END;
      CREATE TRIGGER prompt_version_no_delete BEFORE DELETE ON agent_prompt_versions
        BEGIN SELECT RAISE(ABORT,'Prompt versions are immutable'); END;
      CREATE TRIGGER message_prompt_no_update BEFORE UPDATE ON message_prompt_versions
        BEGIN SELECT RAISE(ABORT,'Message prompt references are immutable'); END;
      CREATE TRIGGER message_prompt_no_delete BEFORE DELETE ON message_prompt_versions
        BEGIN SELECT RAISE(ABORT,'Message prompt references are immutable'); END;
      CREATE TRIGGER message_prompt_same_agent BEFORE INSERT ON message_prompt_versions
        WHEN NOT EXISTS(SELECT 1 FROM messages m JOIN sessions ss ON ss.id=m.session_id WHERE m.id=NEW.message_id AND ss.agent_id=NEW.agent_id)
        BEGIN SELECT RAISE(ABORT,'Message prompt must belong to the session AI'); END;
      INSERT INTO schema_migrations VALUES(12,datetime('now'));
    `);
    // Earlier messages have no recorded prompt. Do not manufacture historical bindings.
  });
}
