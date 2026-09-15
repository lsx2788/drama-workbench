import type { Store } from "./db";
import { DomainError } from "./common";
import { STORY_MAX_BYTES } from "../shared/story-import";
import { importStory } from "./story-service";
import { importStoryBatchForm } from "./story-batch-service";

export async function importStoryRequest(
  s: Store,
  request: Request,
  projectId?: string,
) {
  if (request.headers.get("content-type")?.includes("application/json"))
    return importStory(s, await request.json(), projectId);
  const form = await request.formData();
  if (form.get("source") === "files")
    return importStoryBatchForm(s, form, projectId);
  if (form.getAll("file").length > 1)
    throw new DomainError("INVALID_INPUT", "多文件上传请使用 source=files");
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
