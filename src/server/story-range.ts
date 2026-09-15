import { openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store } from "./db";
import { requireRow, assert, DomainError } from "./common";
export const SOURCE_RANGE_MAX_BYTES = 512 * 1024;
export const sourceReferenceSchema = z
  .object({
    storyId: z.uuid(),
    startByte: z.number().int().nonnegative().optional(),
    endByte: z.number().int().positive().optional(),
    encoding: z.enum(["utf-8", "gb18030"]).optional(),
    locator: z.string().max(1000).default(""),
  })
  .strict();
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export function validateSourceReference(
  s: Store,
  p: string,
  ref: SourceReference,
) {
  const source = requireRow(
    s.one(
      "SELECT * FROM story_sources WHERE id=? AND project_id=?",
      ref.storyId,
      p,
    ),
    "原始故事",
  );
  const ranged =
    ref.startByte !== undefined ||
    ref.endByte !== undefined ||
    ref.encoding !== undefined;
  if (ranged) {
    assert(
      ref.startByte !== undefined &&
        ref.endByte !== undefined &&
        ref.encoding !== undefined,
      "文本片段必须明确起止字节与编码",
    );
    assert(
      [".txt", ".md"].includes(
        path.extname(String(source.original_name)).toLowerCase(),
      ),
      "仅 TXT/Markdown 支持文本字节范围，其他文件请引用原件并说明位置",
    );
    assert(
      ref.endByte! > ref.startByte! && ref.endByte! <= Number(source.size),
      "原文范围越界",
    );
  }
  return source;
}
/** Exact caller-specified byte range; no chapter detection or import-time parsing. */
export function readStoryRange(
  s: Store,
  p: string,
  storyId: string,
  input: unknown,
) {
  const query = z
    .object({
      startByte: z.coerce.number().int().nonnegative(),
      endByte: z.coerce.number().int().positive(),
      encoding: z.enum(["utf-8", "gb18030"]),
    })
    .strict()
    .parse(input);
  const source = validateSourceReference(s, p, {
    storyId,
    ...query,
    locator: "",
  });
  const length = Math.min(
    query.endByte - query.startByte,
    SOURCE_RANGE_MAX_BYTES,
  );
  const bytes = Buffer.alloc(length);
  const fd = openSync(path.join(s.root, "files", String(source.file_key)), "r");
  let count = 0;
  try {
    while (count < bytes.length) {
      const read = readSync(
        fd,
        bytes,
        count,
        bytes.length - count,
        query.startByte + count,
      );
      if (!read) break;
      count += read;
    }
  } finally {
    closeSync(fd);
  }
  assert(count === bytes.length, "原文文件长度与存储记录不一致");
  const truncated = query.startByte + length < query.endByte;
  // Only a server-imposed page boundary may move to finish a character.
  // Explicit caller boundaries and invalid bytes must still fail.
  for (let trim = 0; trim <= (truncated ? 3 : 0); trim++) {
    try {
      const text = new TextDecoder(query.encoding, {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes.subarray(0, length - trim));
      const endByte = query.startByte + length - trim;
      return {
        storyId,
        sourceSha256: source.sha256,
        ...query,
        endByte,
        requestedEndByte: query.endByte,
        hasMore: endByte < query.endByte,
        text,
      };
    } catch {
      // Try trimming an incomplete trailing character on this page only.
    }
  }
  throw new DomainError(
    "INVALID_RANGE",
    "编码或字节边界不正确，请明确编码并调整范围",
    400,
  );
}
