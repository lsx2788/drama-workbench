import { z } from "zod";
import type { Store, Row } from "./db";
import { audit, DomainError, now, requireRow } from "./common";
import { configLayers, recordConfigLayers } from "./agent-config-layers";
import type { SkillConfiguration } from "../shared/agent-prompt";
import {
  AGENT_PROMPT_MAX_LENGTH,
  type PromptVersion,
  type PromptSettings,
} from "../shared/agent-prompt";

function scopedAgent(s: Store, p: string, agentId: string) {
  return requireRow(
    s.one(
      "SELECT a.* FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE a.id=? AND w.project_id=?",
      agentId,
      p,
    ),
    "AI",
  );
}
function present(row: Row): PromptVersion {
  return {
    agentId: String(row.agent_id),
    version: Number(row.version),
    instructions: String(row.instructions),
    createdAt: String(row.created_at),
    origin: row.origin as PromptVersion["origin"],
  };
}
export function recordInitialPrompt(s: Store, agentId: string) {
  s.run(
    "INSERT INTO agent_prompt_versions SELECT id,config_version,instructions,?,'created' FROM agents WHERE id=?",
    now(),
    agentId,
  );
  recordConfigLayers(s, agentId);
}
export function promptVersion(
  s: Store,
  p: string,
  agentId: string,
  version: number,
): PromptVersion {
  scopedAgent(s, p, agentId);
  const result = present(
    requireRow(
      s.one(
        "SELECT * FROM agent_prompt_versions WHERE agent_id=? AND version=?",
        agentId,
        version,
      ),
      "提示词版本",
    ),
  );
  const layers = configLayers(s, agentId, version);
  return layers ? { ...result, layers } : result;
}
export function promptSettings(
  s: Store,
  p: string,
  agentId: string,
): PromptSettings {
  const agent = scopedAgent(s, p, agentId);
  const current = promptVersion(s, p, agentId, Number(agent.config_version));
  return {
    name: String(agent.name),
    current,
    availableSkills: (
      s.all("SELECT * FROM skills ORDER BY name,id") as SkillConfiguration[]
    ).filter(
      (skill) =>
        (current.layers?.allowedTools ?? []).includes(skill.capability) &&
        !current.layers?.system.requiredSkills.some(
          (required) => required.id === skill.id,
        ),
    ),
    versions: s
      .all(
        "SELECT agent_id,version,created_at,origin FROM agent_prompt_versions WHERE agent_id=? ORDER BY version DESC",
        agentId,
      )
      .map((row) => ({
        agentId,
        version: Number(row.version),
        createdAt: String(row.created_at),
        origin: row.origin as PromptVersion["origin"],
      })),
  };
}
const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    instructions: z.string().max(AGENT_PROMPT_MAX_LENGTH),
    optionalTools: z.array(z.string().min(1).max(100)).max(30).optional(),
    optionalSkillIds: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();
export function updateAgentPrompt(
  s: Store,
  p: string,
  agentId: string,
  input: unknown,
) {
  const d = updateSchema.parse(input);
  return s.transaction(() => {
    const agent = scopedAgent(s, p, agentId);
    const layers = configLayers(s, agentId, Number(agent.config_version));
    const tools =
      d.optionalTools ??
      layers?.optionalTools ??
      (JSON.parse(String(agent.tools_json)) as string[]);
    const skillIds =
      d.optionalSkillIds ??
      layers?.optionalSkills.map((skill) => skill.id) ??
      [];
    if (
      new Set(tools).size !== tools.length ||
      new Set(skillIds).size !== skillIds.length
    )
      throw new DomainError("INVALID_SELECTION", "能力或 Skill 不能重复选择");
    if (
      d.optionalTools &&
      (!layers || tools.some((tool) => !layers.allowedTools.includes(tool)))
    )
      throw new DomainError(
        "CAPABILITY_DENIED",
        "只能选择此 AI 已获准的用户扩展能力，不能修改系统必备能力",
      );
    const skills = skillIds.map(
      (id) =>
        requireRow(
          s.one("SELECT * FROM skills WHERE id=?", id),
          "Skill",
        ) as SkillConfiguration,
    );
    if (
      layers &&
      skills.some(
        (skill) =>
          !tools.includes(skill.capability) ||
          layers.system.requiredSkills.some(
            (required) => required.id === skill.id,
          ),
      )
    )
      throw new DomainError(
        "CAPABILITY_DENIED",
        "所选 Skill 需要已选择且获准的用户扩展能力；系统 Skill 不可修改",
      );
    const selectionChanged =
      !!layers &&
      (JSON.stringify([...tools].sort()) !==
        JSON.stringify([...layers.optionalTools].sort()) ||
        JSON.stringify([...skillIds].sort()) !==
          JSON.stringify(
            layers.optionalSkills.map((skill) => skill.id).sort(),
          ));
    // Identical retries are safe even if their original expected version is old.
    if (d.instructions === agent.instructions && !selectionChanged)
      return promptSettings(s, p, agentId);
    if (d.expectedVersion !== agent.config_version)
      throw new DomainError(
        "PROMPT_CONFLICT",
        "提示词已在别处更新，你的编辑仍保留。请查看最新版本后再保存。",
        409,
      );
    const version = Number(agent.config_version) + 1;
    s.run(
      "UPDATE agents SET instructions=?,config_version=?,tools_json=? WHERE id=?",
      d.instructions,
      version,
      JSON.stringify(tools),
      agentId,
    );
    if (layers) {
      s.run("DELETE FROM agent_skills WHERE agent_id=?", agentId);
      for (const skill of skills)
        s.run("INSERT INTO agent_skills VALUES(?,?)", agentId, skill.id);
    }
    s.run(
      "INSERT INTO agent_prompt_versions VALUES(?,?,?,?,?)",
      agentId,
      version,
      d.instructions,
      now(),
      "updated",
    );
    if (layers) recordConfigLayers(s, agentId, layers);
    audit(s, p, "agent.prompt_updated", agentId, {
      previousVersion: agent.config_version,
      version,
    });
    return promptSettings(s, p, agentId);
  });
}
export function messagePrompt(s: Store, p: string, messageId: string) {
  const message = requireRow(
    s.one(
      "SELECT m.id,ss.agent_id FROM messages m JOIN sessions ss ON ss.id=m.session_id JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE m.id=? AND w.project_id=?",
      messageId,
      p,
    ),
    "消息",
  );
  const reference = s.one(
    "SELECT version FROM message_prompt_versions WHERE message_id=?",
    messageId,
  );
  return {
    messageId,
    snapshot: reference
      ? promptVersion(s, p, String(message.agent_id), Number(reference.version))
      : null,
    basis: reference ? "submitted" : "unrecorded",
  };
}
