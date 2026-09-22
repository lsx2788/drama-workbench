import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { database } from "@/server/database";
import { filePath, readMaterial } from "@/server/files";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    db = database();
  const f = db.one<{
    id: string;
    project_id: string;
    mime: string;
    name: string;
    size: number;
  }>("SELECT * FROM files WHERE id=?", id);
  if (!f) return Response.json({ error: "文件不存在" }, { status: 404 });
  if (new URL(request.url).searchParams.get("preview") === "text") {
    try {
      const offset = Number(
        new URL(request.url).searchParams.get("offset") ?? 0,
      );
      return Response.json(
        await readMaterial(db, f.project_id, id, offset, 12000),
      );
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "无法预览" },
        { status: 415 },
      );
    }
  }
  const safeInline = /^(image\/(png|jpeg|gif|webp)|video\/)/.test(f.mime);
  const headers: Record<string, string> = {
    "Content-Type": f.mime,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  };
  const range = request.headers.get("range");
  let start = 0,
    end = f.size - 1,
    status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${f.size}` },
      });
    if (!m[1]) start = Math.max(0, f.size - Number(m[2]));
    else start = Number(m[1]);
    if (m[1] && m[2]) end = Math.min(end, Number(m[2]));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= f.size
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${f.size}` },
      });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${f.size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  return new Response(
    Readable.toWeb(
      createReadStream(filePath(db, id), { start, end }),
    ) as ReadableStream,
    { status, headers },
  );
}
