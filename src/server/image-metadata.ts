import sharp from "sharp";
import type { Database } from "./database";

export type ImageDimensions = { width: number; height: number };

/** Read original file headers; never resize or infer dimensions from a prompt. */
export async function imageDimensions(bytes: Buffer): Promise<ImageDimensions> {
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height)
    throw new Error("无法读取图片实际尺寸");
  return { width: metadata.width, height: metadata.height };
}

export function storedDimensions(
  db: Database,
  id: string,
): Partial<ImageDimensions> {
  return (
    db.one<ImageDimensions>(
      "SELECT width,height FROM image_metadata WHERE file_id=?",
      id,
    ) ?? {}
  );
}

export function saveDimensions(
  db: Database,
  id: string,
  size: ImageDimensions,
) {
  db.run(
    "INSERT OR IGNORE INTO image_metadata(file_id,width,height) VALUES(?,?,?)",
    id,
    size.width,
    size.height,
  );
}
