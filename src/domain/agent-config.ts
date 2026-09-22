import type { SkillEntry, SkillDetail, SkillFields, SkillLoad } from "./skills";
export const agentKeys = [
  "coordinator",
  "source",
  "script",
  "episode",
  "board",
  "assets",
  "frames",
  "reviewer",
] as const;
export type AgentKey = (typeof agentKeys)[number];
export const agentNames: Record<AgentKey, string> = {
  coordinator: "总控 AI",
  source: "原作分析 AI",
  script: "编剧 AI · 整体",
  episode: "编剧 AI · 分集",
  board: "分镜 AI",
  assets: "资产制作 AI",
  frames: "画面制作 AI",
  reviewer: "独立审核 AI",
};
export const customFieldLabels = {
  identity: "身份补充",
  goals: "目标补充",
  requirements: "内容要求",
  output: "交付偏好",
  examples: "正例",
  counterexamples: "反例与正确做法",
} as const;
export type CustomInstructions = Record<keyof typeof customFieldLabels, string>;
export const emptyCustomInstructions = (): CustomInstructions => ({
  identity: "",
  goals: "",
  requirements: "",
  output: "",
  examples: "",
  counterexamples: "",
});
export type PromptLayers = {
  skills?: SkillEntry[];
  rulesVersion: string;
  system: string;
  developer?: string;
  role: string;
  custom: string;
  tools: { id: string; name: string }[];
};
export type PromptSettings = {
  key: AgentKey;
  name: string;
  revision: number;
  fields: CustomInstructions;
  layers: PromptLayers;
  versions: { revision: number; createdAt: string }[];
  runs: {
    id: string;
    time: string;
    status: string;
    scope: string;
    revision: number | null;
  }[];
};
export type PromptExecution = {
  skillLoads?: SkillLoad[];
  id: string;
  time: string;
  status: string;
  scope: string;
  revision: number | null;
  layers: PromptLayers | null;
  instructions: string;
  threadId?: string;
  turnId?: string;
};
export type PromptApi = {
  skills(
    projectId: string,
    key: AgentKey,
    kind?: string,
  ): Promise<SkillEntry[]>;
  skill(projectId: string, id: string): Promise<SkillDetail>;
  skillVersion(
    projectId: string,
    id: string,
    revision: number,
  ): Promise<{ revision: number; fields: SkillFields }>;
  saveSkill(
    projectId: string,
    id: string,
    revision: number,
    fields: SkillFields,
  ): Promise<SkillDetail>;
  settings(projectId: string, key: AgentKey): Promise<PromptSettings>;
  version(
    projectId: string,
    key: AgentKey,
    revision: number,
  ): Promise<{ revision: number; fields: CustomInstructions }>;
  execution(projectId: string, runId: string): Promise<PromptExecution>;
  save(
    projectId: string,
    key: AgentKey,
    revision: number,
    fields: CustomInstructions,
  ): Promise<PromptSettings>;
};
