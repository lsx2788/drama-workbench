import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store, Row } from "./db";
import {
  audit,
  DomainError,
  id,
  now,
  projectExists,
  requireRow,
} from "./common";
import { createProjectWithCoordinator } from "./project-bootstrap";
import {
  STORY_EXTENSIONS,
  STORY_MAX_BYTES,
  STORY_MAX_CHARACTERS,
} from "../shared/story-import";

const base = {
  title: z.string().trim().max(200).default(""),
  importKey: z.uuid(),
};
const importSchema = z.discriminatedUnion("source", [
  z
    .object({
      ...base,
      source: z.literal("text"),
      text: z
        .string()
        .max(STORY_MAX_CHARACTERS)
        .refine((v) => !!v.trim(), "请粘贴故事正文"),
    })
    .strict(),
  z
    .object({
      ...base,
      source: z.literal("file"),
      name: z.string().min(1).max(255),
      bytes: z.instanceof(Uint8Array),
    })
    .strict(),
]);
const columns =
  "id,project_id,title,source_kind,original_name,mime,size,sha256,created_at";
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function present(row: Row): Row & { download_url: string } {
  return {
    ...row,
    download_url: `/api/v1/projects/${row.project_id}/stories/${row.id}/download`,
  };
}
export function listStories(s: Store, p: string) {
  projectExists(s, p);
  return s
    .all(
      `SELECT ${columns} FROM story_sources WHERE project_id=? ORDER BY created_at DESC,id`,
      p,
    )
    .map(present);
}
function storedStory(s: Store, p: string, key: string) {
  projectExists(s, p);
  return requireRow(
    s.one("SELECT * FROM story_sources WHERE project_id=? AND id=?", p, key),
    "原始故事",
  );
}
export function storyFile(s: Store, p: string, key: string) {
  const row = storedStory(s, p, key);
  return {
    row,
    bytes: readFileSync(path.join(s.root, "files", String(row.file_key))),
  };
}
export function storyDetail(
  s: Store,
  p: string,
  key: string,
): Row & { download_url: string } {
  projectExists(s, p);
  return {
    ...present(
      requireRow(
        s.one(
          `SELECT ${columns} FROM story_sources WHERE project_id=? AND id=?`,
          p,
          key,
        ),
        "原始故事",
      ),
    ),
  };
}

/** Save bytes before committing references. A failed import never leaves an empty project. */
export function importStory(s: Store, input: unknown, projectId?: string) {
  const d = importSchema.parse(input);
  if (projectId) projectExists(s, projectId);
  const extension =
    d.source === "file" ? path.extname(d.name).toLowerCase() : ".txt";
  if (!STORY_EXTENSIONS.includes(extension))
    throw new DomainError(
      "UNSUPPORTED_STORY",
      "请选择 TXT、Markdown、Word 或 PDF 文件",
    );
  const bytes = d.source === "text" ? Buffer.from(d.text, "utf8") : d.bytes;
  if (!bytes.length || bytes.length > STORY_MAX_BYTES)
    throw new DomainError(
      "STORY_SIZE",
      "故事文件不能为空，且不能超过 20 MB",
      bytes.length ? 413 : 400,
    );
  const title =
    d.title ||
    (d.source === "file"
      ? path.basename(d.name, path.extname(d.name)).slice(0, 200).trim()
      : "") ||
    "未命名故事";
  const name = d.source === "file" ? d.name : `${title}.txt`;
  const sha = digest(bytes);
  const hashParts: unknown[] = [projectId ?? null, d.source, title, name, sha];
  const requestHash = digest(JSON.stringify(hashParts));
  const previous = s.one(
    "SELECT * FROM story_sources WHERE import_key=?",
    d.importKey,
  );
  if (previous) {
    if (previous.request_hash !== requestHash)
      throw new DomainError(
        "IMPORT_CONFLICT",
        "这次导入的内容已改变，请重新打开导入窗口",
        409,
      );
    return {
      project: projectExists(s, String(previous.project_id)),
      story: storyDetail(s, String(previous.project_id), String(previous.id)),
    };
  }
  const key = id(),
    fileKey = `story-${key}${extension}`;
  const filename = path.join(s.root, "files", fileKey);
  const mime =
    extension === ".txt"
      ? "text/plain"
      : extension === ".md"
        ? "text/markdown"
        : extension === ".pdf"
          ? "application/pdf"
          : extension === ".doc"
            ? "application/msword"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // Exclusive creation avoids overwriting any previously stored source.
  let written = false;
  try {
    const fd = openSync(filename, "wx");
    written = true;
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return s.transaction(() => {
      const project = projectId
        ? projectExists(s, projectId)
        : createProjectWithCoordinator(s, { name: title });
      const p = String(project.id);
      s.run(
        "INSERT INTO story_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        key,
        p,
        title,
        d.source,
        name,
        fileKey,
        mime,
        bytes.length,
        sha,
        d.importKey,
        requestHash,
        now(),
        "local-user",
      );
      audit(s, p, "story.imported", key, {
        source: d.source,
        originalName: name,
        sha256: sha,
      });
      return { project, story: storyDetail(s, p, key) };
    });
  } catch (error) {
    if (written) unlinkSync(filename);
    throw error;
  }
}

export async function importStoryRequest(
  s: Store,
  request: Request,
  projectId?: string,
) {
  if (request.headers.get("content-type")?.includes("application/json"))
    return importStory(s, await request.json(), projectId);
  const form = await request.formData();
  const fields = Object.fromEntries(form);
  if (fields.source === "file") {
    const file = fields.file;
    if (!(file instanceof File))
      throw new DomainError("FILE_REQUIRED", "请选择故事文件");
    if (file.size > STORY_MAX_BYTES)
      throw new DomainError("STORY_SIZE", "故事文件不能超过 20 MB", 413);
    const { file: omitted, ...rest } = fields;
    void omitted;
    return importStory(
      s,
      {
        ...rest,
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      projectId,
    );
  }
  return importStory(s, fields, projectId);
}
