import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import sharp from "sharp";
import type { Database } from "./database";
import { ensure } from "./errors";
import type { StoredUpload } from "./studio-service";
import { imageDimensions, saveDimensions } from "./image-metadata";
const types: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/plain",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};
export function filePath(db: Database, id: string) {
  ensure(/^[a-f\d-]{36}$/i.test(id), "文件编号无效");
  return path.join(db.root, "files", id);
}
export async function storeUploads(db: Database, files: File[]) {
  ensure(files.length > 0 && files.length <= 20, "一次请上传 1～20 份文件");
  ensure(
    files.reduce((n, f) => n + f.size, 0) <= 200 * 1024 * 1024,
    "一次上传总大小不能超过 200 MB",
  );
  const saved: StoredUpload[] = [];
  try {
    await mkdir(path.join(db.root, "files"), { recursive: true });
    for (const file of files) {
      ensure(
        file.size > 0 && file.size <= 100 * 1024 * 1024,
        "单个文件须为 1 字节至 100 MB",
      );
      const ext = path.extname(file.name).toLowerCase(),
        mime = types[ext];
      ensure(mime, "暂不支持此文件格式");
      const buffer = Buffer.from(await file.arrayBuffer());
      if (mime === "image/png")
        ensure(
          buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          "PNG 文件格式不正确",
        );
      if (mime === "image/jpeg")
        ensure(buffer[0] === 255 && buffer[1] === 216, "JPEG 文件格式不正确");
      if (ext === ".docx")
        ensure(buffer[0] === 80 && buffer[1] === 75, "Word 文件格式不正确");
      const f = {
        ...(mime.startsWith("image/") ? await imageDimensions(buffer) : {}),
        id: randomUUID(),
        name: path.basename(file.name).slice(0, 240),
        mime,
        size: buffer.length,
        hash: createHash("sha256").update(buffer).digest("hex"),
      };
      await writeFile(filePath(db, f.id), buffer, { flag: "wx" });
      saved.push(f);
    }
    return saved;
  } catch (error) {
    await discardUploads(db, saved);
    throw error;
  }
}
export async function storeChatImages(db: Database, files: File[]) {
  ensure(files.length > 0 && files.length <= 5, "一次最多上传5张图片");
  ensure(
    files.every((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name)),
    "聊天图片支持 PNG、JPG、WEBP、GIF，请将其他格式转换后上传",
  );
  ensure(
    files.every((f) => f.size > 0 && f.size <= 10 * 1024 * 1024),
    "每张图片不能超过10MB",
  );
  ensure(
    files.reduce((n, f) => n + f.size, 0) <= 30 * 1024 * 1024,
    "图片合计不能超过30MB",
  );
  for (const file of files) {
    const format = (
      await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    ).format;
    const extension = path
      .extname(file.name)
      .slice(1)
      .toLowerCase()
      .replace("jpg", "jpeg");
    ensure(
      format === extension,
      "图片实际格式与扩展名不符，请重新导出图片后上传",
    );
  }
  return storeUploads(db, files);
}
export async function storeChatAttachments(db: Database, files: File[]) {
  ensure(files.length > 0 && files.length <= 5, "一次最多上传5份附件");
  ensure(
    files.every((f) => /\.(png|jpe?g|webp|gif|txt|md|docx|pdf)$/i.test(f.name)),
    "支持 PNG、JPG、WEBP、GIF 图片及 TXT、MD、DOCX、PDF 文件",
  );
  ensure(
    files.every(
      (f) =>
        f.size > 0 &&
        f.size <=
          (/\.(png|jpe?g|webp|gif)$/i.test(f.name) ? 10 : 20) * 1024 * 1024,
    ),
    "图片不超过10MB，文档不超过20MB，空文件不能上传",
  );
  ensure(
    files.reduce((n, f) => n + f.size, 0) <= 30 * 1024 * 1024,
    "附件合计不能超过30MB",
  );
  // Validate image bytes before storing any originals, including mixed attachments.
  for (const file of files.filter((f) =>
    /\.(png|jpe?g|webp|gif)$/i.test(f.name),
  )) {
    const format = (
      await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    ).format;
    ensure(
      format ===
        path.extname(file.name).slice(1).toLowerCase().replace("jpg", "jpeg"),
      "图片实际格式与扩展名不符，请重新导出图片后上传",
    );
  }
  return storeUploads(db, files);
}
export async function discardUploads(db: Database, files: StoredUpload[]) {
  await Promise.all(
    files
      .filter((f) => !db.one("SELECT id FROM files WHERE id=?", f.id))
      .map((f) => unlink(filePath(db, f.id)).catch(() => {})),
  );
}
export async function readMaterial(
  db: Database,
  p: string,
  id: string,
  offset = 0,
  limit = 6000,
) {
  const row = db.one<{ name: string; mime: string; size: number }>(
    "SELECT name,mime,size FROM files WHERE id=? AND project_id=?",
    id,
    p,
  );
  ensure(row, "资料不存在", "NOT_FOUND", 404);
  ensure(
    Number.isInteger(offset) &&
      offset >= 0 &&
      Number.isInteger(limit) &&
      limit > 0 &&
      limit <= 12000,
    "读取范围无效",
  );
  if (row.mime.startsWith("image/")) {
    const bytes = await readFile(filePath(db, id));
    const dimensions = await imageDimensions(bytes);
    saveDimensions(db, id, dimensions);
    return {
      ...dimensions,
      kind: "image" as const,
      name: row.name,
      url: `data:${row.mime};base64,${bytes.toString("base64")}`,
    };
  }
  ensure(row.size <= 20 * 1024 * 1024, "此文档较大，请先按部分拆分后提供");
  const buffer = await readFile(filePath(db, id));
  let text: string;
  if (/\.docx$/i.test(row.name))
    text = (await mammoth.extractRawText({ buffer })).value;
  else if (/\.(txt|md)$/i.test(row.name)) text = decodeText(buffer);
  else
    throw new Error(
      "此格式已保存原件，但暂不支持自动读取正文。请提供 TXT、DOCX 或图片。",
    );
  return {
    kind: "text" as const,
    name: row.name,
    text: text.slice(offset, offset + limit),
    offset,
    nextOffset: Math.min(offset + limit, text.length),
    totalCharacters: text.length,
    hasMore: offset + limit < text.length,
  };
}

function decodeText(bytes: Buffer) {
  if (bytes[0] === 255 && bytes[1] === 254)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255)
    return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
