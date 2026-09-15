import type { Store } from "./db";
import { DomainError } from "./common";
import { storyFile } from "./story-service";
import { isStoryImage } from "../shared/story-import";

/** On-demand display headers only: never decode, convert, or modify stored sources. */
export function storyImage(s: Store, projectId: string, storyId: string) {
  const file = storyFile(s, projectId, storyId);
  if (!isStoryImage(String(file.row.mime)))
    throw new DomainError("NOT_IMAGE", "该文件不是可预览的图片", 415);
  const bytes = file.bytes;
  const signature = bytes.subarray(0, 12);
  const mime = signature
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
      ? "image/jpeg"
      : ["GIF87a", "GIF89a"].includes(
            signature.subarray(0, 6).toString("ascii"),
          )
        ? "image/gif"
        : signature.subarray(0, 4).toString("ascii") === "RIFF" &&
            signature.subarray(8, 12).toString("ascii") === "WEBP"
          ? "image/webp"
          : null;
  if (!mime)
    throw new DomainError(
      "INVALID_IMAGE",
      "图片格式无法识别，请下载原文件检查",
      415,
    );
  return { ...file, mime };
}
