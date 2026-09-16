export type AiConnectionStatus = {
  provider: "codex" | "openai";
  configured: boolean;
  model: string;
  message: string;
  models: { model: string; displayName: string; isDefault: boolean }[];
  imageGeneration?: boolean;
  imageModel?: string;
  keySource?: string;
};
