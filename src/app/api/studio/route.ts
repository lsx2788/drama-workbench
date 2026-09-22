import { snapshotResponse } from "@/server/snapshot-response";
import { rawConversations } from "@/server/ai/raw-conversations";
import { after } from "next/server";
import { z } from "zod";
import { database } from "@/server/database";
import { StudioService } from "@/server/studio-service";
import { AiRuntime } from "@/server/ai/runtime";
import { actionSchema, text } from "@/server/contracts";
import {
  discardUploads,
  storeUploads,
  storeChatAttachments,
} from "@/server/files";
import { DomainError, ensure } from "@/server/errors";
import { recycleImage } from "@/server/image-trash";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const messageSchema = z.object({
  type: z.literal("message"),
  projectId: z.string(),
  text,
  requestId: z.string().uuid(),
  replyToId: z.string().uuid().optional(),
  imageRevision: z.number().int().positive().optional(),
});
const actionRequest = z.object({
  type: z.literal("action"),
  projectId: z.string(),
  taskId: z.string(),
  revision: z.number().int().min(0),
  version: z.number().int().positive(),
  action: actionSchema,
  reason: z.string().max(10000).default(""),
});
const confirmRequest = z.object({
  type: z.literal("confirm-plan"),
  projectId: z.string(),
  planId: z.string(),
});
const skipRequest = z.object({
  type: z.literal("skip-confirmation"),
  projectId: z.string().uuid(),
  messageId: z.string().uuid(),
});
const recycleRequest = z.object({
  type: z.literal("recycle-image"),
  projectId: z.string().uuid(),
  fileId: z.string().uuid(),
  action: z.enum(["trash", "restore"]),
  reason: z.string().trim().min(1).max(4000),
});
function services() {
  const service = new StudioService(database());
  return { service, ai: new AiRuntime(service) };
}
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      { error: error.issues.map((i) => i.message).join("；") },
      { status: 400 },
    );
  return Response.json(
    {
      error:
        error instanceof DomainError
          ? error.message
          : error instanceof Error
            ? error.message
            : "操作失败",
    },
    { status: error instanceof DomainError ? error.status : 400 },
  );
}
export async function GET(request: Request) {
  try {
    const { service, ai } = services();
    ai.recover();
    for (const run of ai.queuePendingFeedback()) after(() => ai.start(run));
    for (const run of ai.queueQuestionHandoffs()) after(() => ai.start(run));
    const query = request ? new URL(request.url).searchParams : undefined;
    if (query?.has("raw"))
      return Response.json(
        rawConversations(
          service.db,
          query.get("raw")!,
          query.get("session") ?? undefined,
          query.has("before")
            ? z.coerce.number().int().positive().parse(query.get("before"))
            : undefined,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    return snapshotResponse(service.snapshot(), request);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    // This single-owner service is behind the existing authenticated gateway. Reject cross-site writes.
    const origin = request.headers.get("origin"),
      host =
        request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    ensure(
      !origin || new URL(origin).host === host,
      "请求来源不匹配",
      "FORBIDDEN",
      403,
    );
    ensure(
      Number(request.headers.get("content-length") ?? 0) <= 210 * 1024 * 1024,
      "上传内容过大",
    );
    const { service, ai } = services();
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const form = await request.formData();
      const files = form
        .getAll("files")
        .filter((f): f is File => f instanceof File);
      if (form.get("type") === "message") {
        const p = z.string().uuid().parse(form.get("projectId"));
        const requestId = z.string().uuid().parse(form.get("requestId"));
        const message = z
          .string()
          .trim()
          .max(16000)
          .parse(form.get("text") ?? "");
        const replyToId = form.get("replyToId")
          ? z.string().uuid().parse(form.get("replyToId"))
          : undefined;
        const imageRevision = form.get("imageRevision")
          ? z.coerce.number().int().positive().parse(form.get("imageRevision"))
          : undefined;
        service.project(p);
        if (
          service.db.one(
            "SELECT id FROM messages WHERE project_id=? AND request_id=?",
            p,
            requestId,
          )
        )
          return Response.json(
            ai.queue(p, message, requestId, replyToId, imageRevision),
          );
        const uploads = await storeChatAttachments(service.db, files);
        try {
          const run = ai.queue(
            p,
            message,
            requestId,
            replyToId,
            imageRevision,
            uploads,
          );
          if (run.created) after(() => ai.start(run.id));
          return Response.json(run);
        } finally {
          await discardUploads(service.db, uploads);
        }
      }
      const uploads = await storeUploads(service.db, files);
      try {
        if (form.get("type") === "create") {
          const requestId = z.string().uuid().parse(form.get("requestId"));
          const prior = service.db.one<{ project_id: string }>(
            "SELECT project_id FROM import_requests WHERE id=?",
            requestId,
          );
          if (prior) {
            await discardUploads(service.db, uploads);
            return Response.json({ projectId: prior.project_id });
          }
          const name = z
              .string()
              .trim()
              .min(1)
              .max(120)
              .parse(form.get("name")),
            message = text.parse(form.get("message"));
          const id = service.create(name, message, uploads, requestId),
            run = ai.queueInitial(id);
          after(() => ai.start(run));
          return Response.json({ projectId: id });
        }
        ensure(form.get("type") === "upload", "未知上传操作");
        const p = z.string().parse(form.get("projectId")),
          t = z.string().parse(form.get("taskId"));
        const task = service.project(p).tasks[t];
        ensure(task, "找不到任务");
        ensure(
          ["assets", "frames", "video", "assembly"].includes(task.kind),
          "此节点不接受媒体产出",
        );
        const prefix = ["video", "assembly"].includes(task.kind)
          ? "video/"
          : "image/";
        ensure(
          uploads.every((f) => f.mime.startsWith(prefix)),
          "文件类型与节点不符",
        );
        service.act(
          p,
          t,
          { type: "attach" },
          { role: "human" },
          z.coerce.number().int().min(0).parse(form.get("revision")),
          "",
          z.coerce.number().int().positive().parse(form.get("version")),
          uploads,
        );
        return Response.json({ ok: true });
      } catch (e) {
        await discardUploads(service.db, uploads);
        throw e;
      }
    }
    const body = z
      .union([
        messageSchema,
        actionRequest,
        confirmRequest,
        skipRequest,
        recycleRequest,
      ])
      .parse(await request.json());
    if (body.type === "recycle-image") {
      return Response.json(
        recycleImage(
          service.db,
          body.projectId,
          body.fileId,
          body.action,
          body.reason,
          { role: "human" },
        ),
      );
    }
    if (body.type === "skip-confirmation") {
      service.skipConfirmation(body.projectId, body.messageId);
      return Response.json({ ok: true });
    }
    if (body.type === "message") {
      const run = ai.queue(
        body.projectId,
        body.text,
        body.requestId,
        body.replyToId,
        body.imageRevision,
      );
      if (run.created) after(() => ai.start(run.id));
      return Response.json(run);
    }
    if (body.type === "action") {
      service.act(
        body.projectId,
        body.taskId,
        body.action,
        { role: "human" },
        body.revision,
        body.reason,
        body.version,
      );
      return Response.json({ ok: true });
    }
    ensure(
      !service.db.one(
        "SELECT id FROM runs WHERE project_id=? AND parent_id IS NULL AND status IN ('queued','running')",
        body.projectId,
      ),
      "请等待当前讨论结束后确认",
    );
    service.confirmPlan(body.projectId, body.planId);
    const run = ai.queueInitial(body.projectId);
    after(() => ai.start(run));
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
