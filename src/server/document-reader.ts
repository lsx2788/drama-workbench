import path from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";
import type { Store } from "./db";
import { assert } from "./common";
import { storyFile } from "./story-service";

/** Explicit AI-requested extraction only. Imports and metadata never parse source files. */
export async function readDocument(
  s: Store,
  p: string,
  storyId: string,
  input: unknown,
) {
  const q = z
    .object({
      page: z.number().int().min(1).default(1),
      start: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(24000).default(12000),
    })
    .strict()
    .parse(input);
  const { row, bytes } = storyFile(s, p, storyId);
  const extension = path.extname(String(row.original_name)).toLowerCase();
  let text: string,
    pages: number | null = null;
  if (extension === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const require = createRequire(import.meta.url);
    const root = path
      .dirname(require.resolve("pdfjs-dist/package.json"))
      .replaceAll("\\", "/");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      disableFontFace: true,
      cMapUrl: root + "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: root + "/standard_fonts/",
      verbosity: 0,
    });
    try {
      const doc = await task.promise;
      pages = doc.numPages;
      assert(q.page <= pages, "PDF 页码超出范围");
      const page = await doc.getPage(q.page);
      const content = await page.getTextContent();
      text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      page.cleanup();
    } finally {
      await task.destroy();
    }
  } else {
    assert(
      extension === ".docx",
      "仅支持按需提取 PDF/DOCX；旧 DOC 请转换为 DOCX 或 TXT",
    );
    assert(q.page === 1, "DOCX 按字符范围读取，不支持页码定位");
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  assert(q.start <= text.length, "字符起点超出范围");
  const end = Math.min(text.length, q.start + q.length);
  return {
    storyId,
    page: extension === ".pdf" ? q.page : null,
    pages,
    start: q.start,
    end,
    totalCharacters: text.length,
    text: text.slice(q.start, end),
    hasMore: end < text.length,
    notice: !text.trim()
      ? "本页无可提取文字；可能为扫描图片，请提供图片或文本。本工具不做 OCR。"
      : "仅返回指定范围的文字，不包含文档图片、排版或其他页面。",
  };
}
