import { z } from "zod";
const text = z.string().trim().min(1).max(10000);
const short = z.string().trim().min(1).max(200);
const optionalText = z.string().max(30000).default("");
const ids = z.array(z.string().uuid()).max(100).default([]);
export const projectSchema = z
  .object({ name: short, description: optionalText, goal: optionalText })
  .strict();
export const documentSchema = z
  .object({
    title: short,
    kind: z.enum(["outline", "script", "note"]),
    content: text,
    supersedesId: z.string().uuid().optional(),
  })
  .strict();
export const workflowSchema = z.object({ name: short }).strict();
export const nodeSchema = z
  .object({
    sectionId: z.string().uuid().optional(),
    workflowId: z.string().uuid(),
    name: short,
    objective: optionalText,
    nodeType: z.enum(["coordinator", "work"]).default("work"),
    dependencies: ids,
  })
  .strict();
export const agentSchema = z
  .object({
    nodeId: z.string().uuid(),
    name: short,
    purpose: short,
    instructions: optionalText,
    provider: z.string().max(100).default("unconfigured"),
    model: z.string().max(200).default(""),
    tools: z
      .array(
        z
          .string()
          .min(1)
          .max(100)
          .refine(
            (value) => !value.startsWith("system."),
            "系统必备能力由平台配置",
          ),
      )
      .max(30)
      .default([]),
  })
  .strict();
export const sessionSchema = z
  .object({
    agentId: z.string().uuid(),
    title: short,
    externalSessionId: z.string().max(500).optional(),
    predecessorId: z.string().uuid().optional(),
  })
  .strict();
export const messageSchema = z
  .object({ content: text, quoteId: z.string().uuid().optional() })
  .strict();
export const highlightSchema = z
  .object({
    nodeId: z.string().uuid(),
    kind: z.enum(["goal", "decision", "question", "next_step"]),
    status: z.enum(["proposed", "confirmed"]).default("proposed"),
    content: text,
    rationale: optionalText,
    sourceMessageId: z.string().uuid().optional(),
    supersedesId: z.string().uuid().optional(),
  })
  .strict();
export const assetSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
    name: short,
    kind: z.enum([
      "character",
      "costume",
      "prop",
      "scene",
      "composite",
      "document",
      "image",
      "audio",
      "video",
    ]),
    description: optionalText,
    entityKey: z.string().max(100).default(""),
    attributes: z
      .record(
        z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),
        z.union([z.string().max(500), z.number(), z.boolean()]),
      )
      .default({}),
  })
  .strict();
export const versionSchema = z
  .object({ notes: optionalText, sources: ids })
  .strict();
export const reviewSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    scope: short,
    reason: optionalText,
  })
  .strict();
export const itemSchema = z
  .object({
    nodeId: z.string().uuid(),
    title: short,
    objective: optionalText,
    owner: z.string().max(100).default("local-user"),
    agentId: z.string().uuid().optional(),
    acceptance: optionalText,
    inputs: ids,
    dependencies: ids,
  })
  .strict();
export const itemStateSchema = z
  .object({
    status: z.enum([
      "planned",
      "ready",
      "blocked",
      "review",
      "completed",
      "cancelled",
    ]),
    reason: optionalText,
  })
  .strict();
export const nodeStateSchema = z
  .object({
    status: z.enum(["planned", "active", "blocked", "review", "completed"]),
  })
  .strict();
export const runSchema = z
  .object({
    itemId: z.string().uuid(),
    sessionId: z.string().uuid(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export const skillSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,60}$/),
    name: short,
    version: short,
    description: optionalText,
    capability: short,
  })
  .strict();
