import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import { saveOpenaiConfig } from "../src/server/openai-config";
import { queueAiTurn } from "../src/server/ai-runtime";
import { runCodexSession } from "../src/server/codex-session";
import { workbenchTool } from "../src/server/ai-tools";
import type { RpcData, RpcNotice, RpcRequest } from "../src/server/codex-rpc";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-codex-")),
    s = new Store(root);
  const p = String(createProjectWithCoordinator(s, { name: "隔离验收" }).id);
  const ss = String(s.one("SELECT id FROM sessions LIMIT 1")!.id);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  saveOpenaiConfig(s, {
    apiKey: "test",
    model: "test",
    imageModel: "gpt-image-test",
  });
  return { s, p, ss };
}
class FakeRpc {
  notices = new Set<RpcNotice>();
  onRequest: RpcRequest = async () => ({});
  requests: { method: string; params: RpcData }[] = [];
  starts = 0;
  fail = false;
  emit(method: string, params: RpcData) {
    for (const notice of this.notices) notice(method, params);
  }
  async request(method: string, input: unknown = {}): Promise<RpcData> {
    const params = input as RpcData;
    this.requests.push({ method, params });
    if (method === "thread/start")
      return { thread: { id: `thread-${++this.starts}` } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "turn/start") {
      const turnId = randomUUID(),
        threadId = String(params.threadId);
      setImmediate(() => {
        void (async () => {
          if (this.fail) {
            this.emit("workbench/disconnected", {});
            return;
          }
          await assert.rejects(
            this.onRequest("item/tool/call", {
              threadId: "another-thread",
              tool: "workbench",
              callId: "other",
            }),
          );
          const q = {
            threadId,
            turnId,
            tool: "workbench",
            callId: "same-call",
            arguments: { action: "state", data: "{}" },
          };
          const a = await this.onRequest("item/tool/call", q),
            b = await this.onRequest("item/tool/call", q);
          assert.deepEqual(a, b);
          const item = { type: "agentMessage", id: "item-1", text: "已核对" };
          this.emit("item/completed", { threadId, turnId, item });
          this.emit("item/completed", { threadId, turnId, item });
          this.emit("item/completed", {
            threadId,
            turnId,
            item: {
              type: "imageGeneration",
              id: "item-2",
              status: "completed",
              result: "cG5n",
              revisedPrompt: "叶子",
            },
          });
          this.emit("turn/completed", {
            threadId,
            turn: { id: turnId, status: "completed" },
          });
        })().catch((e) => {
          this.emit("workbench/disconnected", {});
          throw e;
        });
      });
      return { turn: { id: turnId, status: "inProgress" } };
    }
    return {};
  }
}
test("Codex routes tools by thread, deduplicates receipts/items, resumes incrementally and pins new instructions", async (t) => {
  const { s, p, ss } = fixture(t),
    rpc = new FakeRpc();
  let count = 0,
    outputs = 0;
  const connect = async () => ({
    rpc,
    status: { connected: true, imageGeneration: true },
    disabledServers: { untrusted: { enabled: false } },
  });
  const tool = workbenchTool("coordinator");
  async function run(
    content: string,
    contentInstructions: string,
    customTool = tool,
  ) {
    const turn = queueAiTurn(s, p, ss, { requestKey: randomUUID(), content });
    await runCodexSession(
      {
        store: s,
        projectId: p,
        sessionId: ss,
        messageId: String(turn.message_id),
        turnId: String(turn.id),
        model: "test",
        instructions: "system",
        contentInstructions,
        tool: customTool,
        imageGeneration: true,
        onTool: async () => {
          count++;
          return { result: { ok: true } };
        },
        onOutput: () => {
          outputs++;
          return { messageId: "saved" };
        },
      },
      connect,
    );
    s.run("UPDATE ai_turns SET status='completed' WHERE id=?", String(turn.id));
  }
  await run("first-secret", "version-one");
  await run("second-message", "version-two");
  assert.equal(count, 2);
  assert.equal(outputs, 4);
  assert.equal(rpc.starts, 1);
  const resume = rpc.requests.find((r) => r.method === "thread/resume")!;
  assert.equal(resume.params.developerInstructions, "version-two");
  const calls = rpc.requests.filter((r) => r.method === "turn/start");
  assert.ok(!JSON.stringify(calls[1]).includes("first-secret"));
  assert.ok(JSON.stringify(calls[1]).includes("second-message"));
  assert.equal(
    s.one("SELECT external_session_id FROM sessions WHERE id=?", ss)!
      .external_session_id,
    "thread-1",
  );
  await run("third-message", "version-three", {
    ...tool,
    description: "updated tool contract",
  });
  assert.equal(rpc.starts, 2);
  assert.ok(
    JSON.stringify(
      rpc.requests.filter((r) => r.method === "turn/start")[2],
    ).includes("first-secret"),
  );
  assert.equal(rpc.notices.size, 0);
});
test("Codex disconnect fails once, saves failure audit and never automatically resends", async (t) => {
  const { s, p, ss } = fixture(t),
    rpc = new FakeRpc();
  rpc.fail = true;
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "hello",
  });
  await assert.rejects(
    runCodexSession(
      {
        store: s,
        projectId: p,
        sessionId: ss,
        messageId: String(turn.message_id),
        turnId: String(turn.id),
        model: "test",
        instructions: "system",
        contentInstructions: "content",
        tool: workbenchTool("coordinator"),
        imageGeneration: false,
        onTool: async () => ({ result: null }),
        onOutput: () => null,
      },
      async () => ({
        rpc,
        status: { connected: true, imageGeneration: false },
        disabledServers: {},
      }),
    ),
    /连接中断/,
  );
  assert.equal(rpc.requests.filter((r) => r.method === "turn/start").length, 1);
  assert.equal(
    JSON.parse(String(s.one("SELECT output_json FROM ai_calls")!.output_json))
      .status,
    "failed",
  );
  assert.equal(rpc.notices.size, 0);
});
