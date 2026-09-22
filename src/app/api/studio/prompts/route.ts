import { z } from "zod";
import { database } from "@/server/database";
import { DomainError, ensure } from "@/server/errors";
import {
  SkillService,
  skillIdSchema,
  skillFieldsSchema,
} from "@/server/ai/skill-service";
import {
  agentKeySchema,
  customInstructionsSchema,
  PromptService,
} from "@/server/ai/prompt-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const saveSchema = z
  .object({
    projectId: z.string().min(1),
    key: agentKeySchema,
    revision: z.number().int().min(0),
    fields: customInstructionsSchema,
  })
  .strict();
const saveSkillSchema = z
  .object({
    action: z.literal("skill"),
    projectId: z.string().min(1),
    id: skillIdSchema,
    revision: z.number().int().min(0),
    fields: skillFieldsSchema,
  })
  .strict();
function failure(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof z.ZodError
          ? "配置格式不正确或字段超出长度限制"
          : e instanceof Error
            ? e.message
            : "配置操作失败",
    },
    { status: e instanceof DomainError ? e.status : 400 },
  );
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams,
      projectId = z.string().min(1).parse(params.get("projectId"));
    const service = new PromptService(database());
    let data;
    if (params.get("view") === "skills") {
      const skills = new SkillService(database());
      data = params.has("skillId")
        ? params.has("skillRevision")
          ? skills.custom(
              projectId,
              skillIdSchema.parse(params.get("skillId")),
              z.coerce.number().int().min(0).parse(params.get("skillRevision")),
            )
          : skills.detail(projectId, skillIdSchema.parse(params.get("skillId")))
        : skills.catalog(
            projectId,
            agentKeySchema.parse(params.get("key")),
            params.get("kind") ?? undefined,
          );
    } else if (params.has("runId"))
      data = service.execution(
        projectId,
        z.string().uuid().parse(params.get("runId")),
      );
    else {
      const key = agentKeySchema.parse(params.get("key"));
      data = params.has("revision")
        ? service.version(
            projectId,
            key,
            z.coerce.number().int().min(0).parse(params.get("revision")),
          )
        : service.settings(projectId, key);
    }
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
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
    ensure(raw.length <= 100000, "配置内容过长");
    const input = JSON.parse(raw);
    if (input?.action === "skill") {
      const body = saveSkillSchema.parse(input),
        skills = new SkillService(database());
      skills.save(body.projectId, body.id, body.revision, body.fields);
      return Response.json(skills.detail(body.projectId, body.id));
    }
    const body = saveSchema.parse(input),
      service = new PromptService(database());
    service.save(body.projectId, body.key, body.fields, body.revision);
    return Response.json(service.settings(body.projectId, body.key));
  } catch (e) {
    return failure(e);
  }
}
