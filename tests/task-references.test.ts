import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { storeUploads } from "../src/server/files";
import { NodePipeline } from "../src/server/ai/node-pipeline";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import {
  delegationForTask,
  resolveTaskReferences,
  taskReferenceInput,
} from "../src/server/ai/task-references";
import { imageUsage } from "../src/server/image-trash";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
async function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-references-"));
  const db = new Database(root),
    s = new StudioService(db);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const files = await storeUploads(db, [
    new File(["前言角色原文后续章节"], "原文.txt"),
    new File([Buffer.from(png, "base64")], "形象.png"),
  ]);
  const p = s.create("参考交接", "先理解原文", files),
    pipeline = new NodePipeline(s);
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES('parent',?,'completed',?,?)",
    p,
    process.pid,
    new Date().toISOString(),
  );
  const refs = [
    { fileId: files[0].id, purpose: "核对角色描写", offset: 2, limit: 4 },
    { fileId: files[1].id, purpose: "参考人物脸型，不照搬衣服" },
  ];
  return { db, s, p, pipeline, files, refs };
}

test("delegation keeps actual source attachments and bounded text, and exposes clickable references on its message", async (t) => {
  const { db, s, p, pipeline, refs, files } = await fixture(t);
  const job = pipeline.start(
    p,
    "source",
    "核对原文与人物形象",
    "parent",
    undefined,
    refs,
  );
  const delegation = delegationForTask(db, p, "source", job)!;
  assert.equal(delegation.references.length, 2);
  assert.equal(
    s.project(p).messages.find((m) => m.id === delegation.messageId)!
      .references![1].purpose,
    refs[1].purpose,
  );
  const input = await taskReferenceInput(db, p, delegation.references);
  assert.ok(
    input.some(
      (x) => x.type === "image" && x.url === `data:image/png;base64,${png}`,
    ),
  );
  assert.ok(
    input.some(
      (x) =>
        x.type === "text" &&
        x.text.includes('"text":"角色原文"') &&
        x.text.includes('"hasMore":true'),
    ),
  );
  assert.equal(s.project(p).assets.length, 0);
  assert.ok(
    imageUsage(db, p, files[1].id).some((x) => x.includes("执行中的任务参考")),
  );
});

test("foreign, missing and trashed references fail atomically before a task is dispatched", async (t) => {
  const { db, s, p, pipeline, refs } = await fixture(t);
  const other = s.create("其他剧本", "资料", []);
  assert.throws(
    () => pipeline.start(other, "source", "引用", "parent", undefined, refs),
    /当前剧本/,
  );
  assert.throws(
    () =>
      pipeline.start(p, "source", "引用", "parent", undefined, [
        { fileId: randomUUID(), purpose: "不存在" },
      ]),
    /不存在/,
  );
  db.run(
    "INSERT INTO image_trash(file_id,reason,actor,trashed_at) VALUES(?,?,?,?)",
    refs[1].fileId,
    "测试回收",
    "human",
    new Date().toISOString(),
  );
  assert.throws(
    () => pipeline.start(p, "source", "引用", "parent", undefined, refs),
    /垃圾篓/,
  );
  assert.equal(db.one<any>("SELECT COUNT(*) n FROM node_jobs").n, 0);
  assert.equal(db.one<any>("SELECT COUNT(*) n FROM node_delegations").n, 0);
});

test("paused resumption inherits reference versions, explicit clearing preserves earlier dispatch history", async (t) => {
  const { db, p, pipeline, refs } = await fixture(t);
  const job = pipeline.start(
    p,
    "source",
    "首次任务",
    "parent",
    undefined,
    refs,
  );
  pipeline.set(job, "paused");
  assert.equal(pipeline.start(p, "source", "继续任务", "parent"), job);
  assert.equal(delegationForTask(db, p, "source", job)!.references.length, 2);
  pipeline.set(job, "paused");
  pipeline.start(p, "source", "改用文字要求", "parent", undefined, []);
  assert.equal(delegationForTask(db, p, "source", job)!.references.length, 0);
  const history = db.all<any>(
    "SELECT reference_files FROM node_delegations ORDER BY rowid",
  );
  assert.equal(history.length, 3);
  assert.equal(
    JSON.parse(history[0].reference_files)[1].file.id,
    refs[1].fileId,
  );
});

test("unparsed original documents remain referenced with an explicit unread warning", async (t) => {
  const { db, s, p } = await fixture(t);
  const uploads = await storeUploads(db, [
    new File(["test pdf bytes"], "扫描原件.pdf"),
  ]);
  const other = s.create("未解析参考", "资料", uploads);
  const refs = resolveTaskReferences(db, other, [
    { fileId: uploads[0].id, purpose: "核对扫描件" },
  ]);
  const input = await taskReferenceInput(db, other, refs);
  assert.ok(
    input.some(
      (x) =>
        x.type === "text" &&
        x.text.includes("尚未成功读取") &&
        x.text.includes("不可声称已读"),
    ),
  );
  assert.throws(
    () =>
      resolveTaskReferences(db, p, [
        { fileId: uploads[0].id, purpose: "越界" },
      ]),
    /当前剧本/,
  );
});

test("runtime sends original image bytes and text to producer, independent reviewer and revision rounds", async (t) => {
  const { db, s, p, refs } = await fixture(t);
  const childInputs: any[] = [];
  let connections = 0;
  const runtime = new AiRuntime(s, () => {
    const index = connections++,
      threadId = `references-${index}`;
    const c: AiConnection = {
      notices: new Set(),
      onRequest: async () => ({}),
      initialize: async () => {},
      close: () => {},
      request: async (method, params) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ model: "test", isDefault: true }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume")
          return { thread: { id: threadId } };
        if (method === "turn/start") {
          const call = async (tool: string, args: any) => {
            const result = (await c.onRequest("item/tool/call", {
              threadId,
              tool,
              callId: randomUUID(),
              arguments: args,
            })) as any;
            assert.equal(result.success, true, JSON.stringify(result));
          };
          if (index === 0)
            await call("delegate", {
              taskId: "source",
              instructions: "按原文核对角色，保留脸型",
              references: refs,
            });
          else {
            childInputs.push(params);
            if (index === 1) {
              const job = db.one<any>(
                "SELECT id,parent_run FROM node_jobs WHERE project_id=? AND task_id='source' ORDER BY rowid DESC LIMIT 1",
                p,
              )!;
              const pipeline = new NodePipeline(s);
              const question = pipeline.question(
                p,
                job.id,
                { role: "executor", taskId: "source" },
                "是否可修改原分析方法？",
              );
              pipeline.decide(
                p,
                job.id,
                { role: "reviewer", taskId: "source" },
                question.questionId,
                true,
                "核对授权",
              );
              const confirmation = s.message(
                p,
                "总控 AI",
                "coordinator",
                "允许调整分析方式吗？",
                undefined,
                undefined,
                { requiresReply: true },
              );
              s.message(
                p,
                "你",
                "human",
                "可以调整方法，但不要改变人物身份。",
                undefined,
                undefined,
                { replyToId: confirmation },
              );
              pipeline.answer(
                p,
                question.questionId,
                "允许调整分析方法，原委派中固定方法的限制取消。",
                job.parent_run,
              );
            } else {
              const received = JSON.stringify(params);
              assert.match(received, /原委派中固定方法的限制取消/);
              assert.match(received, /可以调整方法，但不要改变人物身份/);
            }
            const revision = s.project(p).tasks.source.revision;
            if (index % 2 === 1)
              await call("act", {
                taskId: "source",
                revision,
                action: {
                  type: "save",
                  text: index === 1 ? "原作理解初版" : "依据原件修订",
                },
              });
            else
              await call("act", {
                taskId: "source",
                revision,
                action:
                  index === 2
                    ? { type: "return", reason: "请依据原件补充阅读范围" }
                    : { type: "review" },
                reason: "核对原件",
              });
          }
          for (const notice of c.notices)
            notice("turn/completed", {
              threadId,
              turn: { status: "completed" },
            });
          return { turn: { id: `turn-${index}` } };
        }
        return {};
      },
    };
    return c;
  });
  await runtime.start(
    runtime.queue(p, "参考原文和形象图理解", randomUUID()).id,
  );
  assert.equal(childInputs.length, 4);
  for (const turn of childInputs) {
    assert.ok(
      turn.input.some(
        (x: any) =>
          x.type === "image" && x.url === `data:image/png;base64,${png}`,
      ),
    );
    assert.ok(
      turn.input.some((x: any) => x.text?.includes('"text":"角色原文"')),
    );
    assert.ok(turn.input.some((x: any) => x.text?.includes("保留脸型")));
  }
  assert.equal(s.project(p).tasks.source.delivery, "reviewed");
  assert.equal(s.project(p).tasks.source.revision, 2);
  assert.equal(db.one<any>("SELECT COUNT(*) n FROM node_delegations").n, 1);
});
