import {
  promptSettings,
  promptVersion,
  updateAgentPrompt,
  messagePrompt,
} from "./agent-prompt-service";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { getStore, type Store } from "./db";
import { DomainError, projectExists } from "./common";
import {
  assertProjectNotTrashed,
  listProjectTrash,
  trashProject,
  restoreProject,
} from "./project-trash";
import {
  listProjects,
  archiveProject,
  createDocument,
  createWorkflow,
  createNode,
  activateWorkflow,
  updateNodeState,
  overview,
} from "./project-service";
import {
  createAsset,
  searchAssets,
  assetDetail,
  createVersion,
  addFile,
  reviewVersion,
  lineage,
  getFile,
  versionInProject,
} from "./asset-service";
import {
  createAgent,
  createSession,
  postHumanMessage,
  createHighlight,
  confirmHighlight,
  registerSkill,
  bindSkill,
} from "./collaboration-service";
import {
  createItem,
  setItemState,
  contextForItem,
  prepareRun,
} from "./work-service";
import { nodeStateSchema } from "./schemas";
import { workspace } from "./read-service";
import { skipConfirmation } from "./chat-confirmations";
import { createSection, appendUnit } from "./section-service";
import { createSeason } from "./season-service";
import { createProjectWithCoordinator } from "./project-bootstrap";
import {
  startStoryDiscussion,
  startStoriesDiscussion,
} from "./story-discussion";
import { listStoryPreferences } from "./story-preference-catalog";
import { storyImage } from "./story-image";
import { listStories, storyDetail, storyFile } from "./story-service";
import {
  publicOpenaiConfig,
  saveOpenaiConfig,
  requireOpenaiConfig,
} from "./openai-config";
import { testOpenaiConnection } from "./openai-provider";
import { groupCandidates, setGroupMember } from "./group-service";
import {
  connectionStatus,
  saveConnection,
  ensureConnection,
  refreshCodexStatus,
} from "./codex-connection";
import {
  queueAiTurn,
  scheduleAiTurn,
  listAiTurns,
  turnDetail,
} from "./ai-runtime";

import { importStoryRequest } from "./story-import-request";
import {
  startPreparation,
  listPreparationRecords,
  preparationRecord,
  savePreparationRecord,
  reviewPreparation,
} from "./preparation-service";
import {
  createEpisodes,
  listEpisodes,
  episodeDetail,
  reorderEpisodes,
} from "./episode-service";
import { readStoryRange } from "./story-range";
import { delegateWriting, postAgentMessage } from "./writer-collaboration";
import {
  knowledge,
  knowledgeProposal,
  proposeKnowledge,
  reviewKnowledge,
} from "./knowledge-service";

type Creator = (s: Store, p: string, input: unknown) => unknown;
const creators: Record<string, Creator> = {
  seasons: createSeason,
  sections: createSection,
  units: appendUnit,
  documents: createDocument,
  workflows: createWorkflow,
  nodes: createNode,
  agents: createAgent,
  sessions: createSession,
  highlights: createHighlight,
  assets: createAsset,
  items: createItem,
  runs: prepareRun,
};
const missing = () => {
  throw new DomainError("NOT_FOUND", "接口不存在", 404);
};
function authorize(request: Request) {
  const token = process.env.WORKBENCH_TOKEN;
  if (token) {
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new DomainError("UNAUTHORIZED", "需要 API 访问令牌", 401);
  }
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    // Next.js may normalize request.url to localhost while the browser uses
    // 127.0.0.1. Compare with the original HTTP Host, not the internal URL host.
    const url = new URL(request.url);
    const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
    if (origin && origin !== expectedOrigin)
      throw new DomainError("ORIGIN_DENIED", "拒绝跨来源写入", 403);
    if (Number(request.headers.get("content-length") ?? 0) > 52 * 1024 * 1024)
      throw new DomainError("BODY_TOO_LARGE", "请求超过大小限制", 413);
  }
}
async function route(request: Request, parts: string[]) {
  if (parts.length > 5) return missing();
  const s = getStore(),
    method = request.method;
  if (parts[0] === "ai-connection" && parts.length <= 2) {
    if (parts.length === 1 && method === "GET") return connectionStatus(s);
    if (parts.length === 1 && method === "PATCH")
      return saveConnection(s, await request.json());
    if (parts[1] === "test" && method === "POST") {
      await refreshCodexStatus(s);
      return connectionStatus(s);
    }
  }
  if (parts[0] === "openai" && parts.length <= 2) {
    if (parts.length === 1 && method === "GET") return publicOpenaiConfig(s);
    if (parts.length === 1 && method === "PATCH")
      return saveOpenaiConfig(s, await request.json());
    if (parts[1] === "test" && method === "POST") {
      const config = requireOpenaiConfig(s);
      return testOpenaiConnection(config.apiKey, config.model);
    }
    return missing();
  }
  if (
    parts.length === 1 &&
    parts[0] === "story-preferences" &&
    method === "GET"
  )
    return listStoryPreferences(s);
  if (
    parts.length === 2 &&
    parts[0] === "projects" &&
    parts[1] === "import-story" &&
    method === "POST"
  )
    return importStoryRequest(s, request);
  if (parts.length === 1 && parts[0] === "projects") {
    if (method === "GET") {
      const query = z
        .object({ archived: z.enum(["true", "false"]).optional() })
        .strict()
        .parse(Object.fromEntries(new URL(request.url).searchParams));
      return listProjects(s, query.archived === "true");
    }
    if (method === "POST")
      return createProjectWithCoordinator(s, await request.json());
  }
  if (parts[0] !== "projects" || !parts[1]) return missing();
  if (parts.length === 2 && parts[1] === "trash" && method === "GET")
    return listProjectTrash(s);
  const [, p, resource, key, action] = parts;
  projectExists(s, p);
  if (parts.length === 2 && method === "DELETE") {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(await request.json());
    return trashProject(s, p);
  }
  if (parts.length === 3 && resource === "restore" && method === "POST")
    return restoreProject(s, p);
  assertProjectNotTrashed(s, p);
  if (resource === "sessions" && key && action === "group-members") {
    if (method === "GET") return groupCandidates(s, p, key);
    if (method === "PATCH") {
      const d = z
        .object({ sessionId: z.uuid(), status: z.enum(["active", "paused"]) })
        .strict()
        .parse(await request.json());
      return setGroupMember(s, p, key, d.sessionId, d.status);
    }
  }
  if (resource === "sessions" && key && action === "turns") {
    if (method === "GET") return listAiTurns(s, p, key);
    if (method === "POST") {
      const input = await request.json();
      if (
        !s.one(
          "SELECT 1 FROM ai_turns WHERE project_id=? AND request_key=?",
          p,
          String(input.requestKey ?? ""),
        )
      )
        await ensureConnection(s);
      const turn = queueAiTurn(s, p, key, input);
      scheduleAiTurn(s, p, String(turn.id));
      return turn;
    }
  }
  if (resource === "ai-turns" && key && !action && method === "GET")
    return turnDetail(s, p, key);
  if (method === "GET") {
    if (resource === "versions" && key && !action) {
      const version = versionInProject(s, p, key);
      const asset = assetDetail(s, p, String(version.asset_id));
      return {
        assetId: version.asset_id,
        ...asset.versions.find((row) => row.id === key),
      };
    }
    if (resource === "preparation-records" && !action)
      return key ? preparationRecord(s, p, key) : listPreparationRecords(s, p);
    if (resource === "episodes" && !action)
      return key
        ? episodeDetail(s, p, key)
        : listEpisodes(
            s,
            p,
            Object.fromEntries(new URL(request.url).searchParams),
          );
    if (resource === "knowledge" && !action)
      return key ? knowledgeProposal(s, p, key) : knowledge(s, p);
    if (resource === "stories" && key && action === "range")
      return readStoryRange(
        s,
        p,
        key,
        Object.fromEntries(new URL(request.url).searchParams),
      );
    if (resource === "agents" && key && action === "prompt") {
      const query = z
        .object({ version: z.coerce.number().int().positive().optional() })
        .strict()
        .parse(Object.fromEntries(new URL(request.url).searchParams));
      return query.version
        ? promptVersion(s, p, key, query.version)
        : promptSettings(s, p, key);
    }
    if (resource === "messages" && key && action === "prompt")
      return messagePrompt(s, p, key);
    if (resource === "stories" && key && action === "preview") {
      const { row, bytes, mime } = storyImage(s, p, key);
      return new Response(bytes, {
        headers: {
          "Content-Type": mime,
          "Content-Length": String(bytes.length),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(row.original_name))}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (resource === "stories" && !key) return listStories(s, p);
    if (resource === "stories" && key && !action) return storyDetail(s, p, key);
    if (resource === "stories" && key && action === "download") {
      const { row, bytes } = storyFile(s, p, key);
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(row.original_name))}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (resource === "workspace" && parts.length === 3) return workspace(s, p);
    if (resource === "overview" && parts.length === 3) return overview(s, p);
    if (resource === "assets" && !key) {
      const q = new URL(request.url).searchParams;
      const filters: Record<string, unknown> = {};
      for (const [name, value] of q) {
        if (
          !["code", "kind", "entityKey", "status", "attributes"].includes(name)
        )
          throw new DomainError("INVALID_FILTER", `未知筛选字段：${name}`);
        filters[name] = name === "attributes" ? JSON.parse(value) : value;
      }
      return searchAssets(s, p, filters);
    }
    if (resource === "assets" && key && !action) return assetDetail(s, p, key);
    if (resource === "versions" && action === "lineage")
      return lineage(s, p, key);
    if (resource === "items" && action === "context")
      return contextForItem(s, p, key);
    if (resource === "files" && key && !action) {
      const { file, bytes } = getFile(s, p, key),
        mime = String(file.mime);
      const inline = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "audio/mpeg",
        "audio/wav",
        "video/mp4",
        "video/webm",
      ].includes(mime);
      return new Response(bytes, {
        headers: {
          "Content-Type": inline ? mime : "application/octet-stream",
          "Content-Length": String(bytes.length),
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(String(file.original_name))}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
  }
  if (method === "PATCH" && resource === "agents" && key && action === "prompt")
    return updateAgentPrompt(s, p, key, await request.json());
  if (method === "POST") {
    if (resource === "confirmations" && key && action === "skip")
      return skipConfirmation(s, p, key, await request.json());
    if (resource === "preparation" && !key)
      return startPreparation(s, p, await request.json());
    if (resource === "preparation-records" && !key)
      return savePreparationRecord(s, p, await request.json());
    if (resource === "preparation-records" && key && action === "review")
      return reviewPreparation(s, p, key, await request.json());
    if (resource === "episodes" && !key)
      return createEpisodes(s, p, await request.json());
    if (resource === "writer-delegations" && !key)
      return delegateWriting(s, p, await request.json());
    if (resource === "sessions" && key && action === "agent-messages")
      return postAgentMessage(s, p, key, await request.json());
    if (resource === "knowledge" && !key)
      return proposeKnowledge(s, p, await request.json());
    if (resource === "knowledge" && key && action === "review")
      return reviewKnowledge(s, p, key, await request.json());
    if (resource === "story-discussions" && !key) {
      const { storyIds, ...input } = z
        .object({ storyIds: z.array(z.uuid()).min(1).max(20) })
        .passthrough()
        .parse(await request.json());
      const discussion = startStoriesDiscussion(s, p, storyIds, input);
      if ((await connectionStatus(s)).configured) {
        const turn = queueAiTurn(s, p, discussion.sessionId, {
          requestKey: discussion.messageId,
          messageId: discussion.messageId,
        });
        scheduleAiTurn(s, p, String(turn.id));
        return { ...discussion, execution: turn.status };
      }
      return discussion;
    }
    if (resource === "stories" && key && action === "discussion") {
      const discussion = startStoryDiscussion(s, p, key, await request.json());
      if ((await connectionStatus(s)).configured) {
        const turn = queueAiTurn(s, p, discussion.sessionId, {
          requestKey: discussion.messageId,
          messageId: discussion.messageId,
        });
        scheduleAiTurn(s, p, String(turn.id));
        return { ...discussion, execution: turn.status };
      }
      return discussion;
    }
    if (resource === "stories" && !key)
      return importStoryRequest(s, request, p);
    if (resource && creators[resource] && !key)
      return creators[resource](s, p, await request.json());
    if (resource === "workflows" && action === "activate")
      return activateWorkflow(s, p, key);
    if (resource === "highlights" && action === "confirm")
      return confirmHighlight(s, p, key);
    if (resource === "assets" && action === "versions")
      return createVersion(s, p, key, await request.json());
    if (resource === "versions" && action === "review")
      return reviewVersion(s, p, key, await request.json());
    if (resource === "sessions" && action === "messages")
      return postHumanMessage(s, p, key, await request.json());
    if (resource === "versions" && action === "files") {
      const form = await request.formData(),
        file = form.get("file");
      if (!(file instanceof File))
        throw new DomainError("FILE_REQUIRED", "需要上传 file 字段");
      return addFile(s, p, key, {
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
    if (resource === "skills" && !key)
      return registerSkill(s, await request.json());
    if (resource === "agents" && action === "skills") {
      const d = z
        .object({ skillId: z.string().min(1) })
        .strict()
        .parse(await request.json());
      return bindSkill(s, p, key, d.skillId);
    }
  }
  if (method === "PATCH") {
    if (resource === "episodes" && key === "order" && !action)
      return reorderEpisodes(s, p, await request.json());
    if (resource === "archive" && parts.length === 3) {
      const input = z
        .object({ archived: z.boolean() })
        .strict()
        .parse(await request.json());
      return archiveProject(s, p, input.archived);
    }
    if (resource === "nodes" && key && parts.length === 4)
      return updateNodeState(
        s,
        p,
        key,
        nodeStateSchema.parse(await request.json()).status,
      );
    if (resource === "items" && key && parts.length === 4)
      return setItemState(s, p, key, await request.json());
  }
  return missing();
}
export async function handleApi(request: Request, parts: string[]) {
  const requestId = randomUUID();
  try {
    authorize(request);
    const data = await route(request, parts);
    if (data instanceof Response) return data;
    return Response.json(
      { data, error: null, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "操作失败，请查看服务日志";
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("；");
    } else if (error instanceof SyntaxError) {
      status = 400;
      code = "INVALID_JSON";
      message = "JSON 格式不正确";
    } else
      console.error(
        "workbench request failed",
        requestId,
        error instanceof Error ? error.name : "unknown",
      );
    return Response.json(
      { data: null, error: { code, message }, requestId },
      { status },
    );
  }
}
