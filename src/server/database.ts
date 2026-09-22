import { markLegacyScaffolding } from "./legacy-scaffolding";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seedPromptRules } from "./ai/prompt-rule-store";
import { seedSkills } from "./ai/skill-store";

export class Database {
  readonly db: DatabaseSync;
  private savepoint = 0;
  constructor(
    readonly root = path.resolve(
      /* turbopackIgnore: true */ process.env.STUDIO_DATA_DIR || "data",
    ),
  ) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, "studio.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    const version = this.one<{ user_version: number }>(
      "PRAGMA user_version",
    )!.user_version;
    if (version > 17) {
      this.db.close();
      throw new Error("数据库版本高于当前程序，请升级程序后打开");
    }
    try {
      this.transaction(() => {
        this.db.exec(schema);
        markLegacyScaffolding(this, version);
      });
      seedPromptRules(this);
      seedSkills(this);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).run(...args);
  }
  all<T = Record<string, unknown>>(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).all(...args) as T[];
  }
  one<T = Record<string, unknown>>(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  transaction<T>(operation: () => T): T {
    if (this.db.isTransaction) {
      const name = `studio_${++this.savepoint}`;
      this.db.exec(`SAVEPOINT ${name}`);
      try {
        const result = operation();
        this.db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}

// First schema of the new product. No legacy database or migration is loaded.
const schema = `
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 confirmed INTEGER NOT NULL DEFAULT 0, representative_episode INTEGER NOT NULL DEFAULT 1,
 representative_shot INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
 project_id TEXT NOT NULL REFERENCES projects(id), number INTEGER NOT NULL,
 title TEXT NOT NULL, synopsis TEXT NOT NULL, shots INTEGER NOT NULL,
 PRIMARY KEY(project_id,number)
);
CREATE TABLE IF NOT EXISTS tasks (
 project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, kind TEXT NOT NULL,
 title TEXT NOT NULL, objective TEXT NOT NULL, episode INTEGER, shot INTEGER,
 enabled INTEGER NOT NULL DEFAULT 1, review_enabled INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(project_id,id)
);
CREATE TABLE IF NOT EXISTS dependencies (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, input_id TEXT NOT NULL,
 PRIMARY KEY(project_id,task_id,input_id),
 FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id),
 FOREIGN KEY(project_id,input_id) REFERENCES tasks(project_id,id)
);
CREATE TABLE IF NOT EXISTS outputs (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL,
 text TEXT NOT NULL, asset_ids TEXT NOT NULL, reuse_reason TEXT NOT NULL,
 asset_name TEXT, asset_category TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,task_id,revision), FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id)
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL,
 stage TEXT NOT NULL, decision TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL, FOREIGN KEY(project_id,task_id,revision) REFERENCES outputs(project_id,task_id,revision)
);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, action TEXT NOT NULL,
 revision INTEGER NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id)
);
CREATE TABLE IF NOT EXISTS assets (
 project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, version INTEGER NOT NULL,
 name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, source_ids TEXT NOT NULL,
 task_id TEXT NOT NULL, output_revision INTEGER NOT NULL,
 PRIMARY KEY(project_id,id,version), FOREIGN KEY(project_id,task_id,output_revision) REFERENCES outputs(project_id,task_id,revision)
);
CREATE TABLE IF NOT EXISTS messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 project_id TEXT NOT NULL REFERENCES projects(id), sender TEXT NOT NULL, role TEXT NOT NULL,
 text TEXT NOT NULL, task_id TEXT, request_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(project_id,request_id)
);
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT,
 name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL,
 scope TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_details (
 message_id TEXT PRIMARY KEY REFERENCES messages(id),
 audience TEXT NOT NULL CHECK(audience IN ('human','agents')),
 requires_reply INTEGER NOT NULL DEFAULT 0,
 reply_to_id TEXT REFERENCES messages(id), answered_by TEXT REFERENCES messages(id)
);
CREATE TABLE IF NOT EXISTS confirmation_skips (
 message_id TEXT PRIMARY KEY REFERENCES messages(id),
 notice_id TEXT NOT NULL REFERENCES messages(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS output_files (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL, file_id TEXT NOT NULL REFERENCES files(id),
 PRIMARY KEY(project_id,task_id,revision,file_id), FOREIGN KEY(project_id,task_id,revision) REFERENCES outputs(project_id,task_id,revision)
);
CREATE TABLE IF NOT EXISTS plans (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), body TEXT NOT NULL,
 message_id TEXT NOT NULL REFERENCES messages(id), confirmed_by TEXT REFERENCES messages(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), scope TEXT NOT NULL,
 role TEXT NOT NULL, thread_id TEXT, last_seq INTEGER NOT NULL DEFAULT 0,
 prompt_hash TEXT, UNIQUE(project_id,scope,role)
);
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT REFERENCES sessions(id),
 parent_id TEXT REFERENCES runs(id), message_id TEXT REFERENCES messages(id), status TEXT NOT NULL,
 error TEXT, process_id INTEGER NOT NULL, thread_id TEXT, turn_id TEXT, instructions TEXT,
 started_at TEXT NOT NULL, finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_project_run ON runs(project_id) WHERE parent_id IS NULL AND status IN ('queued','running');
CREATE TABLE IF NOT EXISTS tool_receipts (
 run_id TEXT NOT NULL REFERENCES runs(id), call_id TEXT NOT NULL, name TEXT NOT NULL,
 result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(run_id,call_id)
);
CREATE TABLE IF NOT EXISTS import_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id));
CREATE TABLE IF NOT EXISTS agent_prompt_versions (
 project_id TEXT NOT NULL REFERENCES projects(id), agent_key TEXT NOT NULL, revision INTEGER NOT NULL,
 fields TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,agent_key,revision)
);
CREATE TABLE IF NOT EXISTS prompt_rule_sets (
 version TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_rule_texts (
 version TEXT NOT NULL REFERENCES prompt_rule_sets(version), rule_key TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(trim(body))>0), PRIMARY KEY(version,rule_key)
);
CREATE TABLE IF NOT EXISTS prompt_rule_selection (
 id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL REFERENCES prompt_rule_sets(version)
);
CREATE TABLE IF NOT EXISTS run_prompt_snapshots (
 run_id TEXT PRIMARY KEY REFERENCES runs(id), agent_key TEXT NOT NULL,
 config_revision INTEGER NOT NULL, layers TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id,seq);
CREATE INDEX IF NOT EXISTS files_project ON files(project_id,scope);
CREATE INDEX IF NOT EXISTS reviews_output ON reviews(project_id,task_id,revision);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id);
CREATE TABLE IF NOT EXISTS legacy_scaffolding (project_id TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY(project_id,task_id), FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id));
CREATE TABLE IF NOT EXISTS output_structures (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
 PRIMARY KEY(project_id,task_id,revision), FOREIGN KEY(project_id,task_id,revision) REFERENCES outputs(project_id,task_id,revision)
);
CREATE TABLE IF NOT EXISTS episode_focus (project_id TEXT NOT NULL REFERENCES projects(id), episode INTEGER NOT NULL, shot INTEGER NOT NULL, PRIMARY KEY(project_id,episode));
CREATE TABLE IF NOT EXISTS node_jobs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT NOT NULL,
 message_id TEXT NOT NULL REFERENCES messages(id), parent_run TEXT NOT NULL REFERENCES runs(id),
 status TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_questions (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES node_jobs(id), question TEXT NOT NULL,
 status TEXT NOT NULL, reason TEXT, answer TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_toolsets (session_id TEXT PRIMARY KEY REFERENCES sessions(id), signature TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id),
 run_id TEXT NOT NULL REFERENCES runs(id), session_id TEXT NOT NULL REFERENCES sessions(id),
 kind TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
 revision INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_session ON raw_events(session_id,seq);
CREATE TABLE IF NOT EXISTS node_checkpoints (
 job_id TEXT PRIMARY KEY REFERENCES node_jobs(id), instruction TEXT NOT NULL,
 sender TEXT NOT NULL, round INTEGER NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
);
DROP INDEX IF EXISTS one_active_node_job;
CREATE UNIQUE INDEX one_active_node_job ON node_jobs(project_id,task_id) WHERE status IN ('working','reviewing','revising','waiting','continuing');
CREATE TABLE IF NOT EXISTS image_generations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_id TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(id), call_id TEXT NOT NULL, message_id TEXT NOT NULL REFERENCES messages(id),
 prompt TEXT NOT NULL, name TEXT NOT NULL, aspect_ratio TEXT NOT NULL, reference_ids TEXT NOT NULL,
 status TEXT NOT NULL, file_id TEXT REFERENCES files(id), revision INTEGER, error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(run_id,call_id), FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_image_generation ON image_generations(project_id,task_id) WHERE status='generating';
CREATE UNIQUE INDEX IF NOT EXISTS image_generation_message ON image_generations(message_id);
CREATE TABLE IF NOT EXISTS image_task_specs (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, purpose TEXT NOT NULL, basis_task_id TEXT,
 PRIMARY KEY(project_id,task_id), FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id),
 FOREIGN KEY(project_id,basis_task_id) REFERENCES tasks(project_id,id)
);
CREATE TABLE IF NOT EXISTS ai_message_items (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 run_id TEXT NOT NULL REFERENCES runs(id), item_id TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('commentary','final_answer','unknown')),
 text TEXT NOT NULL, message_id TEXT REFERENCES messages(id), created_at TEXT NOT NULL,
 UNIQUE(run_id,item_id)
);
CREATE INDEX IF NOT EXISTS ai_message_public ON ai_message_items(message_id);
CREATE TABLE IF NOT EXISTS image_trash (
 file_id TEXT PRIMARY KEY REFERENCES files(id), reason TEXT NOT NULL,
 actor TEXT NOT NULL, actor_task_id TEXT, trashed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS image_metadata (
 file_id TEXT PRIMARY KEY REFERENCES files(id), width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0)
);
CREATE TABLE IF NOT EXISTS retired_assets (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, revision INTEGER NOT NULL,
 reason TEXT NOT NULL, actor TEXT NOT NULL, retired_at TEXT NOT NULL, file_ids TEXT NOT NULL,
 PRIMARY KEY(project_id,task_id), FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id)
);
CREATE TABLE IF NOT EXISTS image_feedback (
 message_id TEXT PRIMARY KEY REFERENCES messages(id), project_id TEXT NOT NULL,
 task_id TEXT NOT NULL, revision INTEGER NOT NULL, file_id TEXT NOT NULL REFERENCES files(id),
 status TEXT NOT NULL DEFAULT 'pending', notified_run TEXT, resolution TEXT,
 FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id)
);
CREATE TABLE IF NOT EXISTS node_delegations (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES node_jobs(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL, task_id TEXT NOT NULL,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 instructions TEXT NOT NULL, reference_files TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS node_delegations_task ON node_delegations(project_id,task_id);
CREATE UNIQUE INDEX IF NOT EXISTS node_delegations_message ON node_delegations(message_id);
CREATE INDEX IF NOT EXISTS node_delegations_job ON node_delegations(job_id);
CREATE TABLE IF NOT EXISTS message_files (
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES files(id), PRIMARY KEY(message_id,file_id)
);
CREATE TABLE IF NOT EXISTS skill_releases (version TEXT PRIMARY KEY,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skill_documents (
 version TEXT NOT NULL REFERENCES skill_releases(version),skill_id TEXT NOT NULL,body TEXT NOT NULL,
 PRIMARY KEY(version,skill_id)
);
CREATE TABLE IF NOT EXISTS skill_selection (id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL REFERENCES skill_releases(version));
CREATE TABLE IF NOT EXISTS project_skill_versions (
 project_id TEXT NOT NULL REFERENCES projects(id),skill_id TEXT NOT NULL,revision INTEGER NOT NULL,
 fields TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,skill_id,revision)
);
CREATE TABLE IF NOT EXISTS run_skill_loads (
 run_id TEXT NOT NULL REFERENCES runs(id),skill_id TEXT NOT NULL,section TEXT NOT NULL,body TEXT NOT NULL,loaded_at TEXT NOT NULL,
 PRIMARY KEY(run_id,skill_id,section)
);
PRAGMA user_version=17;
`;

const globalDb = globalThis as typeof globalThis & {
  dramaStudioDatabase?: Database;
};
export const database = () => (globalDb.dramaStudioDatabase ??= new Database());
