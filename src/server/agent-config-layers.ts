import type { Store } from "./db";
import type { PromptLayers, SkillConfiguration } from "../shared/agent-prompt";
import { requireRow } from "./common";

export function hasConfigLayers(s: Store) {
  return !!s.one(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_config_layers'",
  );
}
export function configLayers(
  s: Store,
  agentId: string,
  version: number,
): PromptLayers | undefined {
  if (!hasConfigLayers(s)) return undefined;
  const row = s.one(
    "SELECT l.*,p.instructions,p.required_tools_json,p.required_skills_json FROM agent_config_layers l JOIN system_ai_policies p ON p.id=l.policy_id AND p.version=l.policy_version WHERE l.agent_id=? AND l.version=?",
    agentId,
    version,
  );
  if (!row) return undefined;
  return {
    system: {
      id: String(row.policy_id),
      version: Number(row.policy_version),
      instructions: String(row.instructions),
      requiredTools: JSON.parse(String(row.required_tools_json)),
      requiredSkills: JSON.parse(String(row.required_skills_json)),
    },
    optionalTools: JSON.parse(String(row.optional_tools_json)),
    optionalSkills: JSON.parse(String(row.optional_skills_json)),
    allowedTools: JSON.parse(String(row.allowed_tools_json)),
  };
}
export function selectedSkills(
  s: Store,
  agentId: string,
): SkillConfiguration[] {
  return s.all(
    "SELECT sk.* FROM skills sk JOIN agent_skills b ON b.skill_id=sk.id WHERE b.agent_id=? ORDER BY sk.id",
    agentId,
  ) as SkillConfiguration[];
}
export function recordConfigLayers(
  s: Store,
  agentId: string,
  previous?: PromptLayers,
) {
  if (!hasConfigLayers(s)) return;
  const agent = requireRow(
    s.one(
      "SELECT a.*,n.node_type FROM agents a JOIN nodes n ON n.id=a.node_id WHERE a.id=?",
      agentId,
    ),
    "AI",
  );
  const tools = JSON.parse(String(agent.tools_json)) as string[];
  const profile = s.one(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='node_ai_profiles'",
  )
    ? s.one(
        "SELECT profile_id FROM node_ai_profiles WHERE node_id=?",
        String(agent.node_id),
      )?.profile_id
    : undefined;
  const policyId = previous?.system.id ?? String(profile ?? agent.node_type);
  const policyVersion =
    previous?.system.version ??
    Number(
      s.one(
        "SELECT MAX(version) AS version FROM system_ai_policies WHERE id=?",
        policyId,
      )?.version,
    );
  s.run(
    "INSERT INTO agent_config_layers VALUES(?,?,?,?,?,?,?)",
    agentId,
    Number(agent.config_version),
    policyId,
    policyVersion,
    JSON.stringify(tools),
    JSON.stringify(selectedSkills(s, agentId)),
    JSON.stringify(previous?.allowedTools ?? tools),
  );
}
