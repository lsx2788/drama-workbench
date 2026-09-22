import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { ImageService, imageSchema } from "../src/server/ai/images";
import { decodeGeneratedImage } from "../src/server/ai/image-provider";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import { NodePipeline } from "../src/server/ai/node-pipeline";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
async function fixture(t: any, accepted = false) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-feedback-")),
    db = new Database(root),
    s = new StudioService(db),
    p = s.create("图片指导", "测试", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const images = new ImageService(s, async () => decodeGeneratedImage(png)),
    args = imageSchema.parse({
      name: "场景图",
      category: "场景",
      prompt: "测试场景",
      reuseReason: "测试",
    }),
    task = images.task(p, args, "fixture");
  const run = randomUUID();
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
    run,
    p,
    process.pid,
    new Date().toISOString(),
  );
  const generated = await images.generate(
    p,
    task,
    { ...args, revision: 0 },
    { role: "executor", taskId: task },
    run,
    "image-1",
  );
  const message = db.one<any>(
    "SELECT message_id FROM image_generations WHERE run_id=?",
    run,
  ).message_id;
  if (accepted) {
    s.act(
      p,
      task,
      { type: "review" },
      { role: "reviewer", taskId: task },
      1,
      "已看图",
    );
    s.act(p, task, { type: "accept" }, { role: "coordinator" }, 1, "通过");
  }
  return { db, s, p, task, run, images, args, generated, message };
}
test("coordinator can return an accepted image only with real user evidence; new version is reviewed again", async (t) => {
  const { db, s, p, task, run, images, args, generated } = await fixture(
    t,
    true,
  );
  assert.throws(
    () =>
      s.act(
        p,
        task,
        { type: "return", reason: "修改" },
        { role: "coordinator" },
        1,
      ),
    /用户/,
  );
  const human = s.message(p, "你", "human", "把背景改浅");
  s.act(
    p,
    task,
    { type: "return", reason: "用户要求背景改浅" },
    { role: "coordinator" },
    1,
    "",
    undefined,
    [],
    false,
    human,
  );
  assert.equal(s.project(p).tasks[task].delivery, "returned");
  assert.equal(s.project(p).assets.length, 0);
  assert.equal(
    db.one<any>(
      "SELECT COUNT(*) n FROM reviews WHERE project_id=? AND task_id=? AND stage='acceptance' AND decision='pass'",
      p,
      task,
    ).n,
    1,
  );
  await images.generate(
    p,
    task,
    { ...args, revision: 1 },
    { role: "executor", taskId: task },
    run,
    "image-2",
  );
  assert.equal(s.project(p).tasks[task].revision, 2);
  assert.equal(s.project(p).tasks[task].delivery, "draft");
  assert.equal(s.outputFiles(p, task, 1)[0].id, generated.fileId);
  assert.throws(
    () =>
      s.act(p, task, { type: "accept" }, { role: "coordinator" }, 2, "通过"),
    /审核/,
  );
});

test("resolved user image directions do not consume the automatic correction limit", async (t) => {
  const { db, s, p, task, run, message } = await fixture(t);
  db.run("UPDATE runs SET status='running' WHERE id=?", run);
  const runtime = new AiRuntime(s), pipeline = new NodePipeline(s);
  s.act(p, task, { type: "return", reason: "需修正姿态" }, { role: "reviewer", taskId: task }, 1);
  for (let i = 0; i < 3; i++) {
    const requestId = randomUUID();
    runtime.queue(p, `用户补充姿态依据${i}`, requestId, message, 1);
    const human = db.one<any>("SELECT id FROM messages WHERE project_id=? AND request_id=?", p, requestId)!.id;
    s.resolveFeedback(p, human, 1, "revise", `按用户补充依据${i}修改`);
  }
  const job = pipeline.start(p, task, "根据新依据返修", run);
  const result = await pipeline.drive(p, job, "根据新依据返修", async actor => {
    if (actor.role === "executor")
      s.act(p, task, { type: "save", text: "依据已处理的用户意见修订，原图仍需独立审查" }, actor, 1);
    else s.act(p, task, { type: "review" }, actor, 2, "独立核对图片及新依据");
    return "";
  });
  assert.equal(result.status, "submitted");
  assert.equal(s.project(p).tasks[task].delivery, "reviewed");
  assert.equal(s.project(p).tasks[task].revision, 2);
});
test("busy-time quoted image feedback is saved once, version bound, and prevents review until coordinator routes it", async (t) => {
  const { db, s, p, task, message } = await fixture(t),
    runtime = new AiRuntime(s),
    pipeline = new NodePipeline(s);
  const root = runtime.queue(p, "继续审核", randomUUID()).id;
  const job = pipeline.start(p, task, "审核现有图片", root),
    request = randomUUID();
  const queued = runtime.queue(p, "背景太深", request, message, 1);
  assert.equal(queued.created, false);
  assert.equal(queued.id, root);
  runtime.queue(p, "背景太深", request, message, 1);
  assert.equal(s.pendingFeedback(p).length, 1);
  assert.throws(
    () => runtime.queue(p, "过期图片", randomUUID(), message, 99),
    /版本/,
  );
  const other = s.create("其他剧本", "测试", []);
  assert.throws(
    () => runtime.queue(other, "跨项目", randomUUID(), message, 1),
    /版本/,
  );
  assert.throws(
    () =>
      s.act(
        p,
        task,
        { type: "review" },
        { role: "reviewer", taskId: task },
        1,
        "通过",
      ),
    /用户图片意见/,
  );
  let calls = 0;
  const result = await pipeline.drive(p, job, "", async () => {
    calls++;
    return "";
  });
  assert.equal(result.status, "user_feedback");
  assert.equal(calls, 0);
  const feedback = s.pendingFeedback(p)[0];
  const routed = s.resolveFeedback(
    p,
    feedback.message_id,
    1,
    "revise",
    "背景改浅，人物不变",
  );
  assert.equal(routed.taskId, task);
  assert.equal(s.project(p).tasks[task].delivery, "returned");
  assert.equal(s.pendingFeedback(p).length, 0);
  assert.equal(
    db.one<any>(
      "SELECT status FROM image_feedback WHERE message_id=?",
      feedback.message_id,
    ).status,
    "revise",
  );
});
test("feedback arriving inside internal review pauses the node instead of submitting or auto-accepting", async (t) => {
  const { s, p, task, message } = await fixture(t),
    runtime = new AiRuntime(s),
    pipeline = new NodePipeline(s),
    root = runtime.queue(p, "审核", randomUUID()).id;
  const job = pipeline.start(p, task, "审核", root);
  const result = await pipeline.drive(p, job, "", async (actor) => {
    assert.equal(actor.role, "reviewer");
    runtime.queue(p, "请修改颜色", randomUUID(), message, 1);
    s.act(p, task, { type: "review" }, actor, 1, "准备通过");
    return "";
  });
  assert.equal(result.status, "user_feedback");
  assert.equal(s.project(p).tasks[task].delivery, "draft");
});
test("feedback on a merged task image card resolves the exact displayed image revision", async (t) => {
  const { s, p, task, generated } = await fixture(t);
  const runtime = new AiRuntime(s),
    pipeline = new NodePipeline(s);
  const root = runtime.queue(p, "继续审核", randomUUID()).id;
  const job = pipeline.start(p, task, "审核图片", root);
  const anchor = pipeline.job(p, job).message_id;
  runtime.queue(p, "调整此图", randomUUID(), anchor, 1);
  assert.equal(s.pendingFeedback(p)[0].file_id, generated.fileId);
  assert.equal(s.pendingFeedback(p)[0].revision, 1);
  assert.throws(
    () => runtime.queue(p, "错误版本", randomUUID(), anchor, 99),
    /版本/,
  );
});
test("received feedback survives interruption and is queued once, without replaying already delivered advice", async (t) => {
  const { db, s, p, message } = await fixture(t);
  const runtime = new AiRuntime(s);
  const first = runtime.queue(p, "正在审核", randomUUID()).id;
  runtime.queue(p, "调整背景", randomUUID(), message, 1);
  assert.deepEqual(runtime.queuePendingFeedback(), []);
  db.run("UPDATE runs SET status='interrupted' WHERE id=?", first);
  const resumed = runtime.queuePendingFeedback();
  assert.equal(resumed.length, 1);
  assert.deepEqual(runtime.queuePendingFeedback(), []);
  assert.equal(
    db.one<any>("SELECT message_id FROM runs WHERE id=?", resumed[0])
      .message_id,
    s.pendingFeedback(p)[0].message_id,
  );
  db.run(
    "UPDATE image_feedback SET notified_run=? WHERE project_id=?",
    resumed[0],
    p,
  );
  db.run("UPDATE runs SET status='interrupted' WHERE id=?", resumed[0]);
  assert.deepEqual(runtime.queuePendingFeedback(), []);
});
test("coordinator automatically receives busy-time feedback in a subsequent turn without inventing a human message", async (t) => {
  const { db, s, p, message } = await fixture(t, true);
  let turnCount = 0;
  let runtime: AiRuntime;
  runtime = new AiRuntime(s, () => {
    const c: AiConnection = {
      notices: new Set(),
      onRequest: async () => ({}),
      initialize: async () => {},
      close: () => {},
      request: async (method) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ model: "test", isDefault: true }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume")
          return { thread: { id: "feedback" } };
        if (method === "turn/start") {
          if (++turnCount === 1)
            runtime.queue(p, "颜色是否太深？", randomUUID(), message, 1);
          else {
            const f = s.pendingFeedback(p)[0];
            const read = (await c.onRequest("item/tool/call", {
              threadId: "feedback",
              tool: "read_material",
              callId: randomUUID(),
              arguments: { fileId: f.file_id },
            })) as any;
            assert.equal(read.success, true);
            const resolved = (await c.onRequest("item/tool/call", {
              threadId: "feedback",
              tool: "resolve_image_feedback",
              callId: randomUUID(),
              arguments: {
                messageId: f.message_id,
                revision: 1,
                decision: "keep",
                reason: "经核对维持当前颜色",
              },
            })) as any;
            assert.equal(resolved.success, true);
          }
          for (const notice of c.notices)
            notice("turn/completed", {
              threadId: "feedback",
              turn: { status: "completed" },
            });
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  await runtime.start(runtime.queue(p, "查看进度", randomUUID()).id);
  assert.equal(turnCount, 2);
  assert.equal(s.pendingFeedback(p).length, 0);
  assert.equal(
    db.one<any>(
      "SELECT COUNT(*) n FROM messages WHERE project_id=? AND role='human'",
      p,
    ).n,
    3,
  );
});
test("explicitly returned storyboard can replace an existing approved slice while preserving history and flagging downstream", async (t) => {
  const { db, s, p } = await fixture(t);
  db.run("UPDATE projects SET confirmed=1 WHERE id=?", p);
  db.run("INSERT INTO episodes VALUES(?,1,'测试','测试',0)", p);
  const id = "episode-1-storyboard";
  db.run(
    "INSERT INTO tasks VALUES(?,?,'storyboard','分镜','分镜',1,NULL,1,1)",
    p,
    id,
  );
  const save = (text: string, revision: number) =>
    s.act(
      p,
      id,
      {
        type: "save",
        text,
        structure: {
          kind: "shots",
          complete: true,
          representative: 1,
          reason: "测试",
          items: [{ number: 1, title: "镜头", synopsis: "", text }],
        },
      },
      { role: "human" },
      revision,
    );
  const accept = (revision: number) => {
    s.act(p, id, { type: "review" }, { role: "human" }, revision, "审核");
    s.act(p, id, { type: "accept" }, { role: "coordinator" }, revision, "验收");
  };
  save("旧正文", 0);
  accept(1);
  s.act(
    p,
    "episode-1-shot-1-assets",
    { type: "save", text: "旧资产说明" },
    { role: "human" },
    0,
  );
  const human = s.message(p, "你", "human", "调整镜头动作");
  s.act(
    p,
    id,
    { type: "return", reason: "调整镜头动作" },
    { role: "coordinator" },
    1,
    "",
    undefined,
    [],
    false,
    human,
  );
  save("修订正文", 1);
  accept(2);
  const project = s.project(p);
  assert.equal(project.tasks["episode-1-shot-1-board"].revision, 2);
  assert.equal(
    project.tasks["episode-1-shot-1-board"].history[0].text,
    "旧正文",
  );
  assert.equal(project.tasks["episode-1-shot-1-assets"].delivery, "returned");
});
