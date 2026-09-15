export const STORY_MAX_BYTES = 20 * 1024 * 1024;
export const STORY_MAX_CHARACTERS = 2_000_000;
export const STORY_EXTENSIONS = [".txt", ".md", ".doc", ".docx", ".pdf"];
export const STORY_STYLES = [
  { value: "discuss", label: "让 AI 阅读后再一起讨论" },
  { value: "live_action", label: "真人影视感" },
  { value: "anime_2d", label: "2D 动漫" },
  { value: "animation_3d", label: "3D 动画" },
  { value: "ink", label: "国风水墨" },
  { value: "illustration", label: "绘本插画" },
  { value: "other", label: "其他（自定义）" },
] as const;
export type StoryStyle = (typeof STORY_STYLES)[number]["value"];
export function storyStyleLabel(style: string, customStyle = "") {
  return style === "other"
    ? customStyle
    : (STORY_STYLES.find((s) => s.value === style)?.label ?? "未填写");
}
export type StoryDiscussion = {
  nodeId: string;
  sessionId: string;
  messageId: string;
  delivery: "stored";
  execution: "not_configured";
};

// LAN HTTP pages lack randomUUID(), but still expose getRandomValues().
export function createImportKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
