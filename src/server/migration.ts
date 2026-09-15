// Add new numbered migrations rather than editing existing live schema definitions.
export const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, goal TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
 kind TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL, supersedes_id TEXT REFERENCES documents(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','active','archived')), created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_workflow ON workflows(project_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS nodes (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), name TEXT NOT NULL, objective TEXT NOT NULL,
 node_type TEXT NOT NULL CHECK(node_type IN ('coordinator','work')),
 status TEXT NOT NULL CHECK(status IN ('planned','active','blocked','review','completed')),
 position INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_dependencies (
 node_id TEXT NOT NULL REFERENCES nodes(id), depends_on TEXT NOT NULL REFERENCES nodes(id), PRIMARY KEY(node_id,depends_on), CHECK(node_id<>depends_on)
);
CREATE TABLE IF NOT EXISTS agents (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), name TEXT NOT NULL, purpose TEXT NOT NULL,
 instructions TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
 config_version INTEGER NOT NULL DEFAULT 1, tools_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, description TEXT NOT NULL, capability TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_skills (
 agent_id TEXT NOT NULL REFERENCES agents(id), skill_id TEXT NOT NULL REFERENCES skills(id), PRIMARY KEY(agent_id,skill_id)
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), title TEXT NOT NULL, provider TEXT NOT NULL,
 external_session_id TEXT, predecessor_id TEXT REFERENCES sessions(id), status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), sender_type TEXT NOT NULL CHECK(sender_type IN ('human','agent','system')),
 sender_id TEXT NOT NULL, content TEXT NOT NULL, quote_id TEXT REFERENCES messages(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS highlights (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), kind TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','superseded')),
 content TEXT NOT NULL, rationale TEXT NOT NULL, source_message_id TEXT REFERENCES messages(id),
 supersedes_id TEXT REFERENCES highlights(id), actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), code TEXT NOT NULL, name TEXT NOT NULL,
 kind TEXT NOT NULL, description TEXT NOT NULL, attributes_json TEXT NOT NULL,
 entity_key TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,code)
);
CREATE TABLE IF NOT EXISTS asset_versions (
 id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('candidate','approved','rejected')),
 notes TEXT NOT NULL, approval_scope TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(asset_id,version)
);
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES asset_versions(id), file_key TEXT NOT NULL UNIQUE,
 original_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_sources (
 version_id TEXT NOT NULL REFERENCES asset_versions(id), source_version_id TEXT NOT NULL REFERENCES asset_versions(id),
 PRIMARY KEY(version_id,source_version_id), CHECK(version_id<>source_version_id)
);
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id), title TEXT NOT NULL, objective TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('planned','ready','running','blocked','review','completed','cancelled')),
 owner TEXT NOT NULL, agent_id TEXT REFERENCES agents(id), acceptance TEXT NOT NULL, block_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_dependencies (
 item_id TEXT NOT NULL REFERENCES items(id), depends_on TEXT NOT NULL REFERENCES items(id), PRIMARY KEY(item_id,depends_on), CHECK(item_id<>depends_on)
);
CREATE TABLE IF NOT EXISTS asset_usages (
 item_id TEXT NOT NULL REFERENCES items(id), version_id TEXT NOT NULL REFERENCES asset_versions(id), PRIMARY KEY(item_id,version_id)
);
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), session_id TEXT NOT NULL REFERENCES sessions(id),
 idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, config_snapshot TEXT NOT NULL, input_snapshot TEXT NOT NULL,
 error TEXT NOT NULL DEFAULT '', provider_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES asset_versions(id), actor TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), scope TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), action TEXT NOT NULL, target_id TEXT NOT NULL,
 details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,created_at);
CREATE INDEX IF NOT EXISTS highlights_node ON highlights(node_id,status);
CREATE INDEX IF NOT EXISTS reverse_sources ON asset_sources(source_version_id);
INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
CREATE TABLE IF NOT EXISTS project_archives (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), archived_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations VALUES(2,datetime('now'));
CREATE TABLE IF NOT EXISTS workflow_sections (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id),
 phase TEXT NOT NULL CHECK(phase IN ('preparation','unit','delivery')),
 kind TEXT NOT NULL CHECK(kind IN ('shared','episode','chapter')),
 name TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_sections (
 node_id TEXT PRIMARY KEY REFERENCES nodes(id), section_id TEXT NOT NULL REFERENCES workflow_sections(id)
);
INSERT OR IGNORE INTO schema_migrations VALUES(3,datetime('now'));
CREATE TABLE IF NOT EXISTS workflow_seasons (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id),
 name TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(workflow_id,name)
);
CREATE TABLE IF NOT EXISTS section_seasons (
 section_id TEXT PRIMARY KEY REFERENCES workflow_sections(id), season_id TEXT NOT NULL REFERENCES workflow_seasons(id)
);
INSERT OR IGNORE INTO schema_migrations VALUES(4,datetime('now'));
`;
