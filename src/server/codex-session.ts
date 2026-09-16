import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Store } from "./db";
import { assert, DomainError, id, now } from "./common";
import { auditJson, chatContext } from "./ai-context";
import { codexConnection } from "./codex-connection";
import type { CodexRpc, RpcData, RpcNotice } from "./codex-rpc";
import type { AiItem } from "./openai-provider";

type Handler = (params: RpcData) => Promise<unknown>;
type Transport = Pick<CodexRpc, "request" | "notices" | "onRequest">;
const routers = new WeakMap<Transport, Map<string, Handler>>();
function handlers(rpc: Transport) {
  let map = routers.get(rpc);
  if (!map) {
    map = new Map();
    routers.set(rpc, map);
    rpc.onRequest = async (method, params) => {
      const handler = map!.get(String(params.threadId));
      assert(method === "item/tool/call" && handler, "未授权的 Codex 请求");
      return handler(params);
    };
  }
  return map;
}
type Options = {
  store: Store;
  projectId: string;
  sessionId: string;
  messageId: string;
  turnId: string;
  model: string;
  instructions: string;
  contentInstructions: string;
  tool: AiItem;
  imageGeneration: boolean;
  onTool: (input: unknown) => Promise<{ result: unknown; media?: AiItem }>;
  onOutput: (output: AiItem[], responseId: string) => unknown;
};

/** One persistent Codex thread per workbench session. Only scoped dynamic tools cross the boundary. */
export async function runCodexSession(
  o: Options,
  connect: (
    s: Store,
  ) => Promise<{
    rpc: Transport;
    status: { connected: boolean; imageGeneration: boolean };
    disabledServers: RpcData;
  }> = codexConnection,
) {
  const { store: s, projectId: p, sessionId } = o;
  const { rpc, status, disabledServers } = await connect(s);
  assert(status.connected, "本机 Codex 未使用 ChatGPT 登录");
  const cwd = path.join(s.root, "codex-workspaces", p, sessionId);
  mkdirSync(cwd, { recursive: true });
  const spec = {
    type: "function",
    name: o.tool.name,
    description: o.tool.description,
    inputSchema: o.tool.parameters,
  };
  const toolHash = createHash("sha256")
    .update(JSON.stringify(spec))
    .digest("hex");
  const previous = s.one(
    "SELECT * FROM codex_sessions WHERE session_id=?",
    sessionId,
  );
  const reuse = previous?.tool_hash === toolHash;
  const options = {
    model: o.model,
    cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    baseInstructions: o.instructions,
    developerInstructions: o.contentInstructions,
    config: {
      mcp_servers: disabledServers,
      "features.image_generation": o.imageGeneration && status.imageGeneration,
    },
  };
  const thread = reuse
    ? await rpc.request("thread/resume", {
        ...options,
        threadId: previous.thread_id,
        excludeTurns: true,
      })
    : await rpc.request("thread/start", {
        ...options,
        environments: [],
        dynamicTools: [spec],
      });
  const threadId = String((thread.thread as RpcData).id);
  const context = chatContext(
    s,
    p,
    sessionId,
    o.messageId,
    reuse && previous.last_message_id
      ? String(previous.last_message_id)
      : undefined,
  );
  const input = [
    {
      type: "text",
      text: context.map((m) => `[${m.role}]\n${m.content}`).join("\n\n"),
      text_elements: [],
    },
  ];
  const callId = id();
  s.transaction(() => {
    s.run(
      "INSERT INTO codex_sessions VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET thread_id=excluded.thread_id,tool_hash=excluded.tool_hash,last_message_id=excluded.last_message_id",
      sessionId,
      threadId,
      toolHash,
      reuse ? (previous.last_message_id as string | null) : null,
      now(),
    );
    s.run(
      "UPDATE sessions SET provider='codex',external_session_id=? WHERE id=?",
      threadId,
      sessionId,
    );
    s.run(
      "INSERT INTO ai_calls(id,turn_id,session_id,input_json,created_at) VALUES(?,?,?,?,?)",
      callId,
      o.turnId,
      sessionId,
      auditJson({
        provider: "codex",
        threadId,
        model: o.model,
        instructions: o.instructions,
        contentInstructions: o.contentInstructions,
        dynamicTools: [spec],
        input,
      }),
      now(),
    );
  });
  let responseId = "",
    settled = false,
    timer: ReturnType<typeof setTimeout>;
  const seen = new Set<string>(),
    receipts = new Map<string, Promise<unknown>>();
  const audit: unknown[] = [];
  let resolveDone: () => void, rejectDone: (e: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // A disconnect may occur while turn/start itself is still awaiting an acknowledgement.
  void done.catch(() => {});
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    rejectDone(new DomainError("CODEX_TURN", message, 502));
    if (responseId)
      void rpc
        .request("turn/interrupt", { threadId, turnId: responseId })
        .catch(() => {});
  };
  const notice: RpcNotice = (method, params) => {
    if (method === "workbench/disconnected") {
      fail("本机 Codex 连接中断，已有结果已保存，本轮不会自动重发");
      return;
    }
    if (params.threadId !== threadId || settled) return;
    if (responseId && params.turnId && params.turnId !== responseId) return;
    try {
      if (method === "item/completed") {
        const item = params.item as RpcData;
        if (seen.has(String(item.id))) return;
        seen.add(String(item.id));
        responseId ||= String(params.turnId ?? "");
        let output: AiItem[] = [];
        if (item.type === "agentMessage" && item.text)
          output = [
            {
              type: "message",
              content: [{ type: "output_text", text: item.text }],
            },
          ];
        if (item.type === "imageGeneration") {
          if (item.status !== "completed" || !item.result) {
            fail("Codex 图片生成未完成，已保存其他回复；请稍后继续");
            return;
          }
          output = [
            {
              type: "image_generation_call",
              id: item.id,
              result: item.result,
              revised_prompt: item.revisedPrompt,
            },
          ];
        }
        if (output.length) {
          const saved = o.onOutput(output, responseId);
          audit.push({ itemId: item.id, type: item.type, saved });
          s.run(
            "UPDATE ai_calls SET response_id=?,output_json=? WHERE id=?",
            responseId,
            auditJson({ status: "running", items: audit }),
            callId,
          );
        }
      }
      if (method === "turn/completed") {
        const turn = params.turn as RpcData;
        responseId ||= String(turn.id);
        if (turn.status !== "completed") {
          fail("Codex 本轮未完整结束，已有结果已保存，请检查连接或额度后继续");
          return;
        }
        settled = true;
        resolveDone();
      }
    } catch {
      fail("保存 Codex 回复失败，本轮已停止，请检查本机存储后继续");
    }
  };
  handlers(rpc).set(threadId, async (params) => {
    assert(
      !settled &&
        params.tool === o.tool.name &&
        (!responseId || params.turnId === responseId),
      "会话工具请求不匹配",
    );
    const key = String(params.callId);
    let receipt = receipts.get(key);
    if (!receipt) {
      receipt = (async () => {
        const executed = await o.onTool(params.arguments);
        const serialized = JSON.stringify(executed.result ?? null);
        const contentItems: unknown[] = [
          {
            type: "inputText",
            text:
              serialized.length > 60000
                ? JSON.stringify({
                    notice: "结果过长，请缩小查询范围",
                    preview: serialized.slice(0, 60000),
                  })
                : serialized,
          },
        ];
        if (executed.media?.type === "input_image")
          contentItems.push({
            type: "inputImage",
            imageUrl: executed.media.image_url,
          });
        if (executed.media?.type === "input_file")
          contentItems.push({
            type: "inputText",
            text: "本机 Codex 不能直接接收 input_file。请通过 read_document 按需读取 PDF/DOCX；旧 DOC 请用户转换为 DOCX 或 TXT。",
          });
        return { success: true, contentItems };
      })();
      receipts.set(key, receipt);
    }
    return receipt;
  });
  rpc.notices.add(notice);
  timer = setTimeout(
    () =>
      fail(
        "本轮 Codex 等待超过 15 分钟，已请求停止；已有成果保留，请检查后继续",
      ),
    900_000,
  );
  try {
    const result = await rpc.request("turn/start", {
      threadId,
      input,
      effort: "medium",
    });
    responseId ||= String((result.turn as RpcData).id);
    s.run("UPDATE ai_calls SET response_id=? WHERE id=?", responseId, callId);
    s.run(
      "UPDATE codex_sessions SET last_message_id=? WHERE session_id=?",
      o.messageId,
      sessionId,
    );
    await done;
    s.run(
      "UPDATE ai_calls SET output_json=? WHERE id=?",
      auditJson({ status: "completed", items: audit }),
      callId,
    );
  } catch (error) {
    fail("Codex 请求未完成，本轮不会自动重发");
    s.run(
      "UPDATE ai_calls SET output_json=? WHERE id=?",
      auditJson({ status: "failed", items: audit }),
      callId,
    );
    throw error;
  } finally {
    clearTimeout(timer);
    rpc.notices.delete(notice);
    handlers(rpc).delete(threadId);
    // Release in-memory thread resources; its persistent history remains resumable.
    await rpc.request("thread/unsubscribe", { threadId }, 5000).catch(() => {});
  }
}
