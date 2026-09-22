import { z } from "zod";
import { database } from "@/server/database";
import { StudioService } from "@/server/studio-service";
import { createResourcePackage } from "@/server/resource-package";
import { DomainError, ensure } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({
  projectId: z.string().uuid(),
  shotIds: z.array(z.string().min(1).max(150)).min(1).max(200),
  version: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin"),
      host =
        request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    ensure(
      !origin || new URL(origin).host === host,
      "请求来源不匹配",
      "FORBIDDEN",
      403,
    );
    const raw = await request.text();
    ensure(raw.length <= 40_000, "导出请求过大");
    const args = input.parse(JSON.parse(raw));
    const result = await createResourcePackage(
      new StudioService(database()),
      args.projectId,
      args.shotIds,
      args.version,
    );
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="video-resources.zip"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Cache-Control": "no-store",
        "Content-Length": String(result.buffer.length),
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "导出参数不正确"
            : error instanceof Error
              ? error.message
              : "资源导出失败",
      },
      { status: error instanceof DomainError ? error.status : 400 },
    );
  }
}
