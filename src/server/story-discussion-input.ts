import { z } from "zod";
import type {
  PreferenceCategory,
  StoryPreference,
} from "../shared/story-preferences";

// Transient message input, never a project setting or a separately stored brief.
export const storyDiscussionInput = z
  .object({
    agentId: z.uuid().optional(),
    preferences: z
      .array(
        z
          .object({
            category: z.string().max(100),
            option: z.string().max(100),
            detail: z.string().trim().max(300),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    ideas: z.string().max(5000).default(""),
  })
  .strict();

export function validateDiscussionPreferences(
  values: StoryPreference[],
  catalog: PreferenceCategory[],
) {
  z.array(z.custom<StoryPreference>())
    .superRefine((preferences, ctx) => {
      const seen = new Set<string>();
      preferences.forEach((value, index) => {
        const category = catalog.find((c) => c.id === value.category);
        const option = category?.options.find((o) => o.value === value.option);
        const problem = !category
          ? "偏好类别不存在或已停用，请重新选择"
          : seen.has(value.category)
            ? "同一偏好类别只能选择一次"
            : !option
              ? "该类别没有这个可用选项，请重新选择"
              : option.detailLabel && !value.detail
                ? `请${option.detailLabel}`
                : !option.detailLabel && value.detail
                  ? "当前选项不接受自定义内容"
                  : "";
        if (problem)
          ctx.addIssue({ code: "custom", path: [index], message: problem });
        seen.add(value.category);
      });
    })
    .parse(values);
}
