import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { NodePipeline } from "../src/server/ai/node-pipeline";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";

async function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-question-")),
    db = new Database(root),
    s = new StudioService(db),
    p = s.create("交接", "原文", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES('parent',?,'running',?,?)",
    p,
    process.pid,
    new Date().toISOString(),
  );
  const pipeline = new NodePipeline(s),
    job = pipeline.start(p, "source", "理解原作", "parent");
  const q = pipeline.question(
    p,
    job,
    { role: "executor", taskId: "source" },
    "需要采用重绘还是人工精修？",
  );
  pipeline.decide(
    p,
    job,
    { role: "reviewer", taskId: "source" },
    q.questionId,
    true,
    "影响用户确认的方向",
  );
  await pipeline.drive(p, job, "理解原作", async () => "");
  return { db, s, p, pipeline, q };
}

test("internal questions name their recipient; recovery is durable, bounded and does not invent a human reply", async (t) => {
  const { db, s, p, pipeline, q } = await fixture(t),
    ai = new AiRuntime(s);
  const transfer = s.project(p).messages.find((m) => m.questionTransfer)!;
  assert.match(transfer.sender, /转交总控 AI/);
  assert.equal(transfer.questionTransfer?.status, "pending");
  assert.equal(transfer.confirmation, undefined);
  assert.equal(transfer.audience, "agents");
  assert.deepEqual(ai.queueQuestionHandoffs(), []); // Parent still working.
  db.run("UPDATE runs SET status='failed',error='timeout' WHERE id='parent'");
  const humanCount = () =>
    db.one<any>("SELECT COUNT(*) n FROM messages WHERE role='human'").n;
  const before = humanCount(),
    [id] = ai.queueQuestionHandoffs(p);
  assert.ok(id);
  assert.deepEqual(ai.queueQuestionHandoffs(p), []);
  assert.equal(humanCount(), before);
  assert.equal(
    s.project(p).messages.some((m) => m.text.startsWith("节点问题交接恢复")),
    false,
  );
  db.run("UPDATE runs SET status='failed' WHERE id=?", id);
  assert.deepEqual(
    new AiRuntime(new StudioService(db)).queueQuestionHandoffs(p),
    [],
  );
  pipeline.answer(p, q.questionId, "沿用已确认要求", "parent");
  assert.equal(
    s.project(p).messages.find((m) => m.id === transfer.id)?.questionTransfer
      ?.status,
    "answered",
  );
});

test("an existing user question prevents a duplicate recovery and preserves the pending decision", async (t) => {
  const { db, s, p } = await fixture(t),
    ai = new AiRuntime(s);
  db.run("UPDATE runs SET status='failed' WHERE id='parent'");
  s.message(
    p,
    "总控 AI",
    "coordinator",
    "是否接受构图变化？",
    undefined,
    undefined,
    { requiresReply: true },
  );
  assert.deepEqual(ai.queueQuestionHandoffs(p), []);
  assert.equal(
    s.project(p).messages.filter((m) => m.confirmation?.status === "pending")
      .length,
    1,
  );
});

test("answer_question pause ends the handoff without starting another node or adding review attempts", async (t) => {
  const { db, s, p, pipeline, q } = await fixture(t);
  db.run("UPDATE runs SET status='completed' WHERE id='parent'");
  let connections = 0;
  const ai = new AiRuntime(s, () => {
    connections++;
    const c: AiConnection = {
      notices: new Set(), initialize: async () => {}, close: () => {}, onRequest: async () => ({}),
      request: async (method) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list") return { data: [{ model: "test", isDefault: true }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume") return { thread: { id: "pause-handoff" } };
        if (method === "turn/start") {
          const response = await c.onRequest("item/tool/call", { threadId: "pause-handoff", tool: "answer_question", callId: randomUUID(), arguments: { questionId: q.questionId, answer: "权限待修复，保留原版并停止重试", pause: true } });
          assert.equal((response as { success: boolean }).success, true);
          for (const notify of c.notices) notify("turn/completed", { threadId: "pause-handoff", turn: { status: "completed" } });
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  const [run] = ai.queueQuestionHandoffs(p);
  await ai.start(run);
  assert.equal(connections, 1);
  const question = db.one<any>("SELECT * FROM node_questions WHERE id=?", q.questionId);
  assert.equal(question.status, "answered");
  assert.equal(pipeline.job(p, question.job_id).status, "paused");
  assert.equal(db.all("SELECT * FROM reviews").length, 0);
  assert.equal(db.all("SELECT * FROM runs WHERE parent_id=?", run).length, 0);
  assert.deepEqual(ai.queueQuestionHandoffs(p), []);
});

test("recovered coordinator asks the user through the formal inbox, leaving the node unresolved until a real decision", async (t) => {
  const { db, s, p, q } = await fixture(t);
  db.run("UPDATE runs SET status='failed' WHERE id='parent'");
  const ai = new AiRuntime(s, () => {
    const c: AiConnection = {
      notices: new Set(),
      initialize: async () => {},
      close: () => {},
      onRequest: async () => ({}),
      request: async (method, params) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ model: "test", isDefault: true }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume")
          return { thread: { id: "handoff" } };
        if (method === "turn/start") {
          assert.match(JSON.stringify(params), /接收者是总控 AI/);
          const response = await c.onRequest("item/tool/call", {
            threadId: "handoff",
            tool: "ask_user",
            callId: randomUUID(),
            arguments: {
              text: "目前局部调整不足。重绘可能改变站姿；也可人工精修。你希望选择哪种？",
            },
          });
          assert.equal((response as { success: boolean }).success, true);
          for (const notify of c.notices)
            notify("turn/completed", {
              threadId: "handoff",
              turn: { status: "completed" },
            });
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  const [run] = ai.queueQuestionHandoffs(p);
  await ai.start(run);
  const ask = s
    .project(p)
    .messages.find((m) => m.confirmation?.status === "pending")!;
  assert.equal(ask.sender, "总控 AI");
  assert.match(ask.text, /重绘/);
  assert.equal(
    db.one<any>("SELECT status FROM node_questions WHERE id=?", q.questionId)
      .status,
    "escalated",
  );
  assert.deepEqual(ai.queueQuestionHandoffs(p), []);
});
