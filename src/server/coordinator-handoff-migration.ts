import type { Store } from "./db";
import { updateAgentPrompt } from "./agent-prompt-service";
import { COORDINATOR_HANDOFF_INSTRUCTIONS } from "./coordinator-handoff-instructions";

/** One-time instruction upgrade; session routing remains the runtime's responsibility. */
export function migrateCoordinatorHandoff(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=16")) return;
    for (const agent of s.all(
      "SELECT a.*,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE n.node_type='coordinator'",
    )) {
      const current = String(agent.instructions);
      if (current.includes(COORDINATOR_HANDOFF_INSTRUCTIONS)) continue;
      updateAgentPrompt(s, String(agent.project_id), String(agent.id), {
        expectedVersion: Number(agent.config_version),
        instructions: current
          ? `${current}\n\n${COORDINATOR_HANDOFF_INSTRUCTIONS}`
          : COORDINATOR_HANDOFF_INSTRUCTIONS,
      });
    }
    s.run("INSERT INTO schema_migrations VALUES(16,datetime('now'))");
  });
}
