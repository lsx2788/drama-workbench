import type { Store } from "./db";
import {
  SYSTEM_AI_POLICIES,
  splitLegacyCoordinatorPrompt,
} from "./system-ai-policy";
import { recordConfigLayers } from "./agent-config-layers";
import { audit, now } from "./common";

export function migrateAgentConfigLayers(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=17")) return;
    s.db.exec(`
      CREATE TABLE system_ai_policies (
        id TEXT NOT NULL, version INTEGER NOT NULL, instructions TEXT NOT NULL,
        required_tools_json TEXT NOT NULL, required_skills_json TEXT NOT NULL, PRIMARY KEY(id,version)
      );
      CREATE TABLE agent_config_layers (
        agent_id TEXT NOT NULL, version INTEGER NOT NULL, policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL,
        optional_tools_json TEXT NOT NULL, optional_skills_json TEXT NOT NULL, allowed_tools_json TEXT NOT NULL,
        PRIMARY KEY(agent_id,version), FOREIGN KEY(agent_id,version) REFERENCES agent_prompt_versions(agent_id,version),
        FOREIGN KEY(policy_id,policy_version) REFERENCES system_ai_policies(id,version)
      );
      CREATE TRIGGER system_policy_no_update BEFORE UPDATE ON system_ai_policies BEGIN SELECT RAISE(ABORT,'System policies are immutable'); END;
      CREATE TRIGGER system_policy_no_delete BEFORE DELETE ON system_ai_policies BEGIN SELECT RAISE(ABORT,'System policies are immutable'); END;
      CREATE TRIGGER config_layers_no_update BEFORE UPDATE ON agent_config_layers BEGIN SELECT RAISE(ABORT,'Configuration snapshots are immutable'); END;
      CREATE TRIGGER config_layers_no_delete BEFORE DELETE ON agent_config_layers BEGIN SELECT RAISE(ABORT,'Configuration snapshots are immutable'); END;
    `);
    for (const policy of SYSTEM_AI_POLICIES)
      s.run(
        "INSERT INTO system_ai_policies VALUES(?,?,?,?,?)",
        policy.id,
        policy.version,
        policy.instructions,
        JSON.stringify(policy.requiredTools),
        JSON.stringify(policy.requiredSkills),
      );
    for (const agent of s.all(
      "SELECT a.*,n.node_type,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id",
    )) {
      const content =
        agent.node_type === "coordinator"
          ? splitLegacyCoordinatorPrompt(String(agent.instructions))
          : String(agent.instructions);
      const version = Number(agent.config_version) + 1;
      s.run(
        "UPDATE agents SET instructions=?,config_version=? WHERE id=?",
        content,
        version,
        String(agent.id),
      );
      s.run(
        "INSERT INTO agent_prompt_versions VALUES(?,?,?,?,?)",
        String(agent.id),
        version,
        content,
        now(),
        "updated",
      );
      recordConfigLayers(s, String(agent.id));
      audit(
        s,
        String(agent.project_id),
        "agent.config_layers_migrated",
        String(agent.id),
        { previousVersion: agent.config_version, version },
      );
    }
    s.run("INSERT INTO schema_migrations VALUES(17,datetime('now'))");
  });
}
