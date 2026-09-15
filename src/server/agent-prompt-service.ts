import { z } from "zod";
import type { Store, Row } from "./db";
import { audit, DomainError, now, requireRow } from "./common";
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
}
export function promptVersion(
  s: Store,
  p: string,
  agentId: string,
  version: number,
): PromptVersion {
  scopedAgent(s, p, agentId);
  return present(
    requireRow(
      s.one(
        "SELECT * FROM agent_prompt_versions WHERE agent_id=? AND version=?",
        agentId,
        version,
      ),
      "提示词版本",
    ),
  );
}
export function promptSettings(
  s: Store,
  p: string,
  agentId: string,
): PromptSettings {
  const agent = scopedAgent(s, p, agentId);
  return {
    name: String(agent.name),
    current: promptVersion(s, p, agentId, Number(agent.config_version)),
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
    instructions: z
      .string()
      .max(AGENT_PROMPT_MAX_LENGTH)
      .refine((value) => !!value.trim(), "提示词不能为空"),
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
    // Identical retries are safe even if their original expected version is old.
    if (d.instructions === agent.instructions)
      return promptSettings(s, p, agentId);
    if (d.expectedVersion !== agent.config_version)
      throw new DomainError(
        "PROMPT_CONFLICT",
        "提示词已在别处更新，你的编辑仍保留。请查看最新版本后再保存。",
        409,
      );
    const version = Number(agent.config_version) + 1;
    s.run(
      "UPDATE agents SET instructions=?,config_version=? WHERE id=?",
      d.instructions,
      version,
      agentId,
    );
    s.run(
      "INSERT INTO agent_prompt_versions VALUES(?,?,?,?,?)",
      agentId,
      version,
      d.instructions,
      now(),
      "updated",
    );
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
