import { z } from "zod";
export const text = z.string().trim().min(1).max(100_000);
export const structureSchema = z
  .object({
    kind: z.enum(["episodes", "shots"]),
    complete: z.boolean().default(false),
    representative: z.number().int().positive(),
    reason: text,
    items: z
      .array(
        z.object({
          number: z.number().int().min(1).max(1000),
          title: z.string().trim().min(1).max(200),
          synopsis: z.string().max(10000),
          text,
        }),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.number)).size !== v.items.length)
      ctx.addIssue({ code: "custom", message: "编号不能重复" });
    if (!v.items.some((i) => i.number === v.representative))
      ctx.addIssue({ code: "custom", message: "关键节点必须在本次实际产出中" });
  });
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("save"),
    text,
    structure: structureSchema.optional(),
    assetIds: z.array(z.string()).max(100).optional(),
    reuseReason: z.string().max(10000).optional(),
    assetName: z.string().max(200).optional(),
    assetCategory: z.enum(["人物", "场景", "道具"]).optional(),
  }),
  z.object({ type: z.literal("toggle-executor") }),
  z.object({ type: z.literal("toggle-review") }),
  z.object({ type: z.literal("review") }),
  z.object({ type: z.literal("request-review"), reason: text }),
  z.object({ type: z.literal("accept") }),
  z.object({ type: z.literal("return"), reason: text }),
]);
export const planSchema = z.object({ summary: text }).strict();
export type Plan = z.infer<typeof planSchema>;
export type Actor = {
  role: "human" | "coordinator" | "executor" | "reviewer";
  taskId?: string;
};
