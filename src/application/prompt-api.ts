import type {
  AgentKey,
  CustomInstructions,
  PromptSettings,
  PromptExecution,
} from "../domain/agent-config";
import type { SkillEntry, SkillDetail, SkillFields } from "../domain/skills";
async function read<T>(params: Record<string, string>): Promise<T> {
  const response = await fetch(
    `/api/studio/prompts?${new URLSearchParams(params)}`,
    { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取失败");
  return data;
}
export const promptApi = {
  skills: (projectId: string, key: AgentKey, kind?: string) =>
    read<SkillEntry[]>({
      projectId,
      key,
      view: "skills",
      ...(kind ? { kind } : {}),
    }),
  skill: (projectId: string, id: string) =>
    read<SkillDetail>({ projectId, skillId: id, view: "skills" }),
  skillVersion: (projectId: string, id: string, revision: number) =>
    read<{ revision: number; fields: SkillFields }>({
      projectId,
      skillId: id,
      skillRevision: String(revision),
      view: "skills",
    }),
  async saveSkill(
    projectId: string,
    id: string,
    revision: number,
    fields: SkillFields,
  ): Promise<SkillDetail> {
    const response = await fetch("/api/studio/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "skill",
        projectId,
        id,
        revision,
        fields,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存失败");
    return data;
  },
  settings: (projectId: string, key: AgentKey) =>
    read<PromptSettings>({ projectId, key }),
  version: (projectId: string, key: AgentKey, revision: number) =>
    read<{ revision: number; fields: CustomInstructions }>({
      projectId,
      key,
      revision: String(revision),
    }),
  execution: (projectId: string, runId: string) =>
    read<PromptExecution>({ projectId, runId }),
  async save(
    projectId: string,
    key: AgentKey,
    revision: number,
    fields: CustomInstructions,
  ): Promise<PromptSettings> {
    const response = await fetch("/api/studio/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, key, revision, fields }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存失败");
    return data;
  },
};
