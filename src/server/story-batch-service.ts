import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store } from "./db";
import { DomainError, id, projectExists } from "./common";
import { createProjectWithCoordinator } from "./project-bootstrap";
import { importStory, storyDetail } from "./story-service";
import {
  STORY_BATCH_MAX_BYTES,
  STORY_MAX_BYTES,
  STORY_MAX_FILES,
} from "../shared/story-import";

const batchSchema = z
  .object({
    source: z.literal("files"),
    title: z.string().trim().max(200).default(""),
    importKey: z.uuid(),
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(255),
            bytes: z.instanceof(Uint8Array),
          })
          .strict(),
      )
      .min(1)
      .max(STORY_MAX_FILES),
  })
  .strict();

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** One atomic storage operation; an unsuccessful batch leaves no partial project or files. */
export function importStoryBatch(s: Store, input: unknown, projectId?: string) {
  const d = batchSchema.parse(input);
  if (projectId) projectExists(s, projectId);
  if (d.files.some((f) => !f.bytes.length || f.bytes.length > STORY_MAX_BYTES))
    throw new DomainError(
      "STORY_SIZE",
      "每个文件不能为空，且不能超过 20 MB",
      413,
    );
  if (
    d.files.reduce((sum, f) => sum + f.bytes.length, 0) > STORY_BATCH_MAX_BYTES
  )
    throw new DomainError(
      "STORY_SIZE",
      "一次上传的文件总大小不能超过 50 MB",
      413,
    );
  const hash = digest(
    JSON.stringify([
      projectId ?? null,
      d.title,
      d.files.map((f) => [f.name, digest(f.bytes)]),
    ]),
  );
  const written: string[] = [];
  try {
    return s.transaction(() => {
      const previous = s.one(
        "SELECT * FROM story_import_batches WHERE import_key=?",
        d.importKey,
      );
      if (previous) {
        if (previous.request_hash !== hash)
          throw new DomainError(
            "IMPORT_CONFLICT",
            "这次导入的内容已改变，请重新打开导入窗口",
            409,
          );
        const p = String(previous.project_id);
        const stories = s
          .all(
            "SELECT story_id FROM story_import_batch_files WHERE import_key=? ORDER BY position",
            d.importKey,
          )
          .map((row) => storyDetail(s, p, String(row.story_id)));
        return { project: projectExists(s, p), story: stories[0], stories };
      }
      const title =
        d.title ||
        path
          .basename(d.files[0].name, path.extname(d.files[0].name))
          .slice(0, 200)
          .trim() ||
        "未命名故事";
      const project = projectId
        ? projectExists(s, projectId)
        : createProjectWithCoordinator(s, { name: title });
      const p = String(project.id);
      s.run(
        "INSERT INTO story_import_batches VALUES(?,?,?)",
        d.importKey,
        hash,
        p,
      );
      const stories = d.files.map((file, position) => {
        const { story } = importStory(
          s,
          {
            source: "file",
            name: file.name,
            bytes: file.bytes,
            importKey: id(),
            // A shared title names the project; each source keeps its own filename/title.
            title: d.files.length === 1 ? d.title : "",
          },
          p,
        );
        const stored = s.one(
          "SELECT file_key FROM story_sources WHERE id=?",
          String(story.id),
        )!;
        written.push(path.join(s.root, "files", String(stored.file_key)));
        s.run(
          "INSERT INTO story_import_batch_files VALUES(?,?,?)",
          d.importKey,
          String(story.id),
          position,
        );
        return story;
      });
      return { project, story: stories[0], stories };
    });
  } catch (error) {
    for (const filename of written) unlinkSync(filename);
    throw error;
  }
}

export async function importStoryBatchForm(
  s: Store,
  form: FormData,
  projectId?: string,
) {
  const files = form.getAll("file");
  if (
    !files.length ||
    files.length > STORY_MAX_FILES ||
    files.some((f) => !(f instanceof File))
  )
    throw new DomainError(
      "FILE_REQUIRED",
      `请选择 1–${STORY_MAX_FILES} 个故事文件`,
    );
  const uploads = files as File[];
  if (
    uploads.some((f) => !f.size || f.size > STORY_MAX_BYTES) ||
    uploads.reduce((sum, f) => sum + f.size, 0) > STORY_BATCH_MAX_BYTES
  )
    throw new DomainError(
      "STORY_SIZE",
      "单文件最大 20 MB，一次上传合计最大 50 MB",
      413,
    );
  const fields: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (key === "file") continue;
    if (key in fields)
      throw new DomainError("INVALID_INPUT", `重复字段：${key}`);
    fields[key] = value;
  }
  return importStoryBatch(
    s,
    {
      ...fields,
      files: await Promise.all(
        uploads.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      ),
    },
    projectId,
  );
}
