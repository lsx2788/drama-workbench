export const STORY_MAX_BYTES = 20 * 1024 * 1024;
export const STORY_MAX_FILES = 20;
export const STORY_BATCH_MAX_BYTES = 50 * 1024 * 1024;
export const STORY_MAX_CHARACTERS = 2_000_000;
export const STORY_MIME_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
export const STORY_EXTENSIONS = Object.keys(STORY_MIME_TYPES);
export const STORY_FORMAT_ERROR =
  "请选择 TXT、Markdown、Word、PDF 或 PNG、JPG、WebP、GIF 图片";
export function isStoryImage(mime: string) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime);
}
export function isStoryImageName(name: string) {
  return isStoryImage(
    STORY_MIME_TYPES[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "",
  );
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
