import { z } from "zod";
import type { Store } from "./db";
import { now } from "./common";
import {
  STORY_STYLES,
  STORY_PREFERENCE_CATALOG,
  type StoredStoryBrief,
} from "../shared/story-preferences";

export const storyPreferencesSchema = z
  .array(
    z
      .object({
        category: z.string(),
        option: z.string(),
        detail: z.string().trim().max(300),
      })
      .strict(),
  )
  .max(STORY_PREFERENCE_CATALOG.length)
  .superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const category = STORY_PREFERENCE_CATALOG.find(
        (c) => c.id === value.category,
      );
      const option = category?.options.find((o) => o.value === value.option);
      const problem = !category
        ? "未知的偏好类别"
        : seen.has(value.category)
          ? "同一偏好类别只能选择一次"
          : !option
            ? "该类别没有这个选项"
            : option.detailLabel && !value.detail
              ? `请${option.detailLabel}`
              : !option.detailLabel && value.detail
                ? "当前选项不接受自定义内容"
                : "";
      if (problem)
        ctx.addIssue({ code: "custom", path: [index], message: problem });
      seen.add(value.category);
    });
  });

export const storyBriefFields = {
  style: z.enum(STORY_STYLES.map((s) => s.value)).optional(),
  customStyle: z.string().trim().max(300).optional(),
  preferences: storyPreferencesSchema.optional(),
  ideas: z.string().max(5000).default(""),
};
export const storyBriefSchema = z
  .object(storyBriefFields)
  .superRefine((value, ctx) => {
    if (
      value.preferences !== undefined &&
      (value.style !== undefined || value.customStyle !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "preferences 与旧版风格字段不能同时提供",
      });
  })
  .transform((value): StoredStoryBrief => ({
    preferences: value.preferences ?? [
      {
        category: "style",
        option: value.style ?? "discuss",
        detail: value.customStyle ?? "",
      },
    ],
    ideas: value.ideas,
  }))
  .pipe(z.object({ preferences: storyPreferencesSchema, ideas: z.string() }));
export type StoryBrief = z.infer<typeof storyBriefSchema>;
export function saveStoryBrief(s: Store, storyId: string, brief: StoryBrief) {
  s.run(
    "INSERT INTO story_intake_briefs VALUES(?,?,?,?)",
    storyId,
    JSON.stringify(brief.preferences),
    brief.ideas,
    now(),
  );
}
export function readStoryBrief(
  s: Store,
  storyId: string,
): StoredStoryBrief | null {
  const row = s.one(
    "SELECT preferences_json,ideas FROM story_intake_briefs WHERE story_id=?",
    storyId,
  );
  return row
    ? {
        preferences: JSON.parse(String(row.preferences_json)),
        ideas: String(row.ideas),
      }
    : null;
}
