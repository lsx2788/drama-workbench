import type { Store } from "./db";
import { updateAgentPrompt } from "./agent-prompt-service";
import { COORDINATOR_INTAKE_POLICY } from "./coordinator-intake";
import { COORDINATOR_READING_POLICY } from "./coordinator-reading";
import { STRUCTURED_COORDINATOR_INSTRUCTIONS } from "./coordinator-instructions";

export function formatCoordinatorInstructions(current: string) {
  if (current.includes(STRUCTURED_COORDINATOR_INSTRUCTIONS)) return current;
  // Only replace exact shipped blocks; retain all unrecognized project-specific text.
  const custom = current
    .replace(COORDINATOR_INTAKE_POLICY, "")
    .replace(
      "只在需求明确后调用接口补充相应流程，不预设完整模板；保留已有成果和会话，调整前说明影响。",
      "",
    )
    .replace(COORDINATOR_READING_POLICY, "")
    .trim();
  return custom
    ? `${STRUCTURED_COORDINATOR_INSTRUCTIONS}\n\n## 八、项目补充要求\n${custom}`
    : STRUCTURED_COORDINATOR_INSTRUCTIONS;
}

export function migrateCoordinatorFormat(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT 1 FROM schema_migrations WHERE version=14")) return;
    for (const agent of s.all(
      "SELECT a.*,w.project_id FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE n.node_type='coordinator'",
    )) {
      const instructions = formatCoordinatorInstructions(
        String(agent.instructions),
      );
      if (instructions === agent.instructions) continue;
      updateAgentPrompt(s, String(agent.project_id), String(agent.id), {
        expectedVersion: Number(agent.config_version),
        instructions,
      });
    }
    s.run("INSERT INTO schema_migrations VALUES(14,datetime('now'))");
  });
}
