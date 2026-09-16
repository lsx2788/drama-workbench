import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store } from "./db";
import { DomainError, id } from "./common";

const configSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(1000).optional(),
    model: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._:-]{1,100}$/)
      .default("gpt-6-astra"),
    imageModel: z
      .string()
      .trim()
      .regex(/^gpt-image-[a-zA-Z0-9._-]{1,100}$/)
      .default("gpt-image-2.5-sunburst"),
  })
  .strict();
const configPath = (s: Store) => path.join(s.root, "openai.local.json");
export function openaiConfig(s: Store) {
  const saved = existsSync(configPath(s))
    ? configSchema.parse(JSON.parse(readFileSync(configPath(s), "utf8")))
    : configSchema.parse({});
  return {
    ...saved,
    apiKey: process.env.OPENAI_API_KEY || saved.apiKey || "",
    model: process.env.OPENAI_MODEL || saved.model,
    imageModel: process.env.OPENAI_IMAGE_MODEL || saved.imageModel,
  };
}
export function publicOpenaiConfig(s: Store) {
  const c = openaiConfig(s);
  return {
    provider: "OpenAI",
    configured: !!c.apiKey,
    model: c.model,
    imageModel: c.imageModel,
    keySource: process.env.OPENAI_API_KEY
      ? "environment"
      : c.apiKey
        ? "local"
        : "none",
  };
}
export function saveOpenaiConfig(s: Store, input: unknown) {
  const d = configSchema.parse(input);
  const old = existsSync(configPath(s))
    ? configSchema.parse(JSON.parse(readFileSync(configPath(s), "utf8")))
    : {};
  const temp = `${configPath(s)}.${id()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ ...old, ...d }), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, configPath(s));
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  return publicOpenaiConfig(s);
}
export function requireOpenaiConfig(s: Store) {
  const c = openaiConfig(s);
  if (!c.apiKey)
    throw new DomainError(
      "AI_NOT_CONFIGURED",
      "请先在 OpenAI 连接设置中填写 API Key",
      409,
    );
  return c;
}
