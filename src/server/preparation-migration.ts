import type { Store } from "./db";
import {
  PREPARATION_POLICIES,
  COORDINATOR_PREPARATION_CONTENT,
} from "./preparation-instructions";
import { DEFAULT_COORDINATOR_CONTENT } from "./system-ai-policy";
import { now, audit } from "./common";

export function migratePreparation(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=18")) return;
    s.db.exec(`
      CREATE TABLE node_ai_profiles(node_id TEXT PRIMARY KEY REFERENCES nodes(id),profile_id TEXT NOT NULL);
      CREATE TABLE preparation_setups(project_id TEXT PRIMARY KEY REFERENCES projects(id),workflow_id TEXT NOT NULL REFERENCES workflows(id),coordinator_node_id TEXT NOT NULL REFERENCES nodes(id),analysis_node_id TEXT NOT NULL REFERENCES nodes(id),writing_node_id TEXT NOT NULL REFERENCES nodes(id));
      CREATE TABLE preparation_records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL CHECK(kind IN ('overview','requirements','framework')),author_session_id TEXT NOT NULL REFERENCES sessions(id),basis_id TEXT REFERENCES preparation_records(id),content_json TEXT NOT NULL,previous_id TEXT UNIQUE REFERENCES preparation_records(id),revision INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE preparation_reviews(record_id TEXT PRIMARY KEY REFERENCES preparation_records(id),coordinator_session_id TEXT NOT NULL REFERENCES sessions(id),user_message_id TEXT REFERENCES messages(id),decision TEXT NOT NULL CHECK(decision IN ('confirmed','changes_requested')),reason TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE ai_relations(child_id TEXT PRIMARY KEY REFERENCES agents(id),parent_id TEXT NOT NULL REFERENCES agents(id),CHECK(child_id<>parent_id));
      CREATE TABLE writer_delegations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,parent_session_id TEXT NOT NULL REFERENCES sessions(id),child_session_id TEXT NOT NULL REFERENCES sessions(id),objective TEXT NOT NULL,refs_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,request_key));
      CREATE TABLE episode_entries(section_id TEXT PRIMARY KEY REFERENCES workflow_sections(id),project_id TEXT NOT NULL REFERENCES projects(id),serial INTEGER NOT NULL,framework_id TEXT REFERENCES preparation_records(id),summary TEXT NOT NULL,created_by TEXT REFERENCES agents(id),UNIQUE(project_id,serial));
      CREATE TABLE episode_sources(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES episode_entries(section_id),position INTEGER NOT NULL,story_id TEXT NOT NULL REFERENCES story_sources(id),start_byte INTEGER,end_byte INTEGER,encoding TEXT,locator TEXT NOT NULL);
      CREATE TABLE episode_asset_refs(section_id TEXT NOT NULL REFERENCES episode_entries(section_id),version_id TEXT NOT NULL REFERENCES asset_versions(id),reason TEXT NOT NULL,PRIMARY KEY(section_id,version_id));
      CREATE TABLE writer_batches(project_id TEXT NOT NULL REFERENCES projects(id),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,response_json TEXT NOT NULL,PRIMARY KEY(project_id,request_key));
      CREATE TABLE knowledge_proposals(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),author_session_id TEXT NOT NULL REFERENCES sessions(id),payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE knowledge_reviews(proposal_id TEXT PRIMARY KEY REFERENCES knowledge_proposals(id),coordinator_session_id TEXT NOT NULL REFERENCES sessions(id),decision TEXT NOT NULL CHECK(decision IN ('confirmed','changes_requested')),reason TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE knowledge_entities(project_id TEXT NOT NULL REFERENCES projects(id),code TEXT NOT NULL,data_json TEXT NOT NULL,revision INTEGER NOT NULL,proposal_id TEXT NOT NULL REFERENCES knowledge_proposals(id),PRIMARY KEY(project_id,code));
      CREATE TABLE knowledge_relations(project_id TEXT NOT NULL REFERENCES projects(id),code TEXT NOT NULL,data_json TEXT NOT NULL,revision INTEGER NOT NULL,proposal_id TEXT NOT NULL REFERENCES knowledge_proposals(id),PRIMARY KEY(project_id,code));
      CREATE INDEX episode_project ON episode_entries(project_id,serial);
      CREATE INDEX preparation_project ON preparation_records(project_id,kind,created_at);
    `);
    for (const table of [
      "preparation_records",
      "preparation_reviews",
      "knowledge_proposals",
      "knowledge_reviews",
      "episode_sources",
    ])
      s.db.exec(
        `CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Records are immutable'); END; CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Records are immutable'); END;`,
      );
    for (const policy of PREPARATION_POLICIES)
      s.run(
        "INSERT INTO system_ai_policies VALUES(?,?,?,?,?)",
        policy.id,
        policy.version,
        policy.instructions,
        JSON.stringify(policy.requiredTools),
        JSON.stringify(policy.requiredSkills),
      );
    for (const a of s.all(
      "SELECT a.*,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE n.node_type='coordinator'",
    )) {
      const version = Number(a.config_version) + 1;
      const content =
        a.instructions === DEFAULT_COORDINATOR_CONTENT
          ? COORDINATOR_PREPARATION_CONTENT
          : String(a.instructions);
      s.run(
        "UPDATE agents SET instructions=?,config_version=? WHERE id=?",
        content,
        version,
        String(a.id),
      );
      s.run(
        "INSERT INTO agent_prompt_versions VALUES(?,?,?,?,?)",
        String(a.id),
        version,
        content,
        now(),
        "updated",
      );
      s.run(
        "INSERT INTO agent_config_layers SELECT agent_id,?,'coordinator',2,optional_tools_json,optional_skills_json,allowed_tools_json FROM agent_config_layers WHERE agent_id=? AND version=?",
        version,
        String(a.id),
        Number(a.config_version),
      );
      audit(s, String(a.project_id), "agent.preparation_policy", String(a.id), {
        version,
      });
    }
    for (const p of s.all("SELECT id FROM projects")) {
      let serial = 0;
      for (const section of s.all(
        "SELECT g.id FROM workflow_sections g JOIN workflows w ON w.id=g.workflow_id WHERE w.project_id=? AND g.phase='unit' ORDER BY g.created_at,g.position,g.id",
        String(p.id),
      ))
        s.run(
          "INSERT INTO episode_entries VALUES(?,?,?,?,?,?)",
          String(section.id),
          String(p.id),
          ++serial,
          null,
          "",
          null,
        );
    }
    s.run("INSERT INTO schema_migrations VALUES(18,datetime('now'))");
  });
}
