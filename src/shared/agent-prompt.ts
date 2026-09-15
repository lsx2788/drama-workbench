export const AGENT_PROMPT_MAX_LENGTH = 100_000;
export type Capability = {
  id: string;
  name: string;
  status: "available" | "not_connected";
};
export type SkillConfiguration = {
  id: string;
  name: string;
  version: string;
  description: string;
  capability: string;
};
export type PromptLayers = {
  system: {
    id: string;
    version: number;
    instructions: string;
    requiredTools: Capability[];
    requiredSkills: SkillConfiguration[];
  };
  optionalTools: string[];
  optionalSkills: SkillConfiguration[];
  allowedTools: string[];
};
export type PromptVersion = {
  agentId: string;
  version: number;
  instructions: string;
  createdAt: string;
  origin: "created" | "updated" | "baseline";
  layers?: PromptLayers;
};
export type PromptSettings = {
  name: string;
  current: PromptVersion;
  versions: Omit<PromptVersion, "instructions" | "layers">[];
  availableSkills: SkillConfiguration[];
};
