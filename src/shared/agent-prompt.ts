export const AGENT_PROMPT_MAX_LENGTH = 100_000;
export type PromptVersion = {
  agentId: string;
  version: number;
  instructions: string;
  createdAt: string;
  origin: "created" | "updated" | "baseline";
};
export type PromptSettings = {
  name: string;
  current: PromptVersion;
  versions: Omit<PromptVersion, "instructions">[];
};
