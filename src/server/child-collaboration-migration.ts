import type { Store } from "./db";
import { updateAgentPrompt } from "./agent-prompt-service";
import { CHILD_COLLABORATION_INSTRUCTIONS } from "./child-collaboration-instructions";

/** Extend existing coordinator configurations once, preserving custom text and history. */
export function migrateChildCollaboration(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=15")) return;
    for (const agent of s.all(
      "SELECT a.*,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE n.node_type='coordinator'",
    )) {
      const current = String(agent.instructions);
      if (current.includes(CHILD_COLLABORATION_INSTRUCTIONS)) continue;
      updateAgentPrompt(s, String(agent.project_id), String(agent.id), {
        expectedVersion: Number(agent.config_version),
        instructions: current
          ? `${current}\n\n${CHILD_COLLABORATION_INSTRUCTIONS}`
          : CHILD_COLLABORATION_INSTRUCTIONS,
      });
    }
    s.run("INSERT INTO schema_migrations VALUES(15,datetime('now'))");
  });
}
