import { z } from "zod";
import type { Store } from "./db";
import { now } from "./common";
import { STORY_STYLES } from "../shared/story-import";

export const storyBriefFields = {
  style: z.enum(STORY_STYLES.map((s) => s.value)).default("discuss"),
  customStyle: z.string().trim().max(300).default(""),
  ideas: z.string().max(5000).default(""),
};
export const storyBriefSchema = z
  .object(storyBriefFields)
  .superRefine((value, ctx) => {
    if (value.style === "other" && !value.customStyle.trim())
      ctx.addIssue({
        code: "custom",
        path: ["customStyle"],
        message: "请填写自定义风格",
      });
    if (value.style !== "other" && value.customStyle)
      ctx.addIssue({
        code: "custom",
        path: ["customStyle"],
        message: "仅选择其他风格时填写自定义内容",
      });
  });
export type StoryBrief = z.infer<typeof storyBriefSchema>;
export function saveStoryBrief(s: Store, storyId: string, brief: StoryBrief) {
  s.run(
    "INSERT INTO story_briefs VALUES(?,?,?,?,?)",
    storyId,
    brief.style,
    brief.customStyle,
    brief.ideas,
    now(),
  );
}
export function readStoryBrief(s: Store, storyId: string) {
  const row = s.one(
    "SELECT style,custom_style,ideas FROM story_briefs WHERE story_id=?",
    storyId,
  );
  return row
    ? {
        style: String(row.style),
        customStyle: String(row.custom_style),
        ideas: String(row.ideas),
      }
    : null;
}
