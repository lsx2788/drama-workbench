import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { AiRuntime } from "../src/server/ai/runtime";
import { storeUploads, readMaterial } from "../src/server/files";
function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-test-"));
  const db = new Database(root);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const s = new StudioService(db);
  const p = s.create("测试故事", "先了解原作", []);
  return { db, s, p };
}
const coordinator = { role: "coordinator" as const },
  human = { role: "human" as const };

test("independent exports are visible only in their project without approving tasks or becoming source material", (t) => {
  const { db, s, p } = fixture(t);
  const other = s.create("另一个剧本", "保持独立", []);
  const before = s.project(p);
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO files(id,project_id,task_id,name,mime,size,hash,scope,created_at) VALUES(?,?,NULL,?,?,?,?,?,?)",
    id,
    p,
    "无声预览.mp4",
    "video/mp4",
    128,
    "preview-hash",
    "export",
    new Date().toISOString(),
  );
  const snapshot = s.snapshot();
  assert.equal(snapshot.files[`${p}/exports`][0].url, `/api/files/${id}`);
  assert.deepEqual(snapshot.files[`${other}/exports`], []);
  assert.deepEqual(snapshot.files[`${p}/sources`], []);
  assert.deepEqual(s.project(p).tasks, before.tasks);
  assert.deepEqual(s.project(p).assets, before.assets);
});

test("reply resolves only its referenced confirmation and survives reopening", (t) => {
  const { db, s, p } = fixture(t);
  const ask = (text: string) =>
    s.message(p, "总控 AI", "coordinator", text, undefined, undefined, {
      audience: "human",
      requiresReply: true,
    });
  const first = ask("风格是否用动画？"),
    second = ask("每集多长？");
  s.message(p, "你", "human", "我还想补充背景");
  assert.equal(
    s.project(p).messages.filter((m) => m.confirmation?.status === "pending")
      .length,
    2,
  );
  const runtime = new AiRuntime(s),
    request = crypto.randomUUID();
  const run = runtime.queue(p, "不要动画，改成真人风格", request, first);
  assert.equal(
    runtime.queue(p, "不要动画，改成真人风格", request, first).id,
    run.id,
  );
  const messages = s.project(p).messages;
  assert.equal(
    messages.find((m) => m.id === first)?.confirmation?.status,
    "answered",
  );
  assert.equal(
    messages.find((m) => m.id === second)?.confirmation?.status,
    "pending",
  );
  assert.equal(messages.at(-1)?.replyToId, first);
  assert.equal(s.project(p).tasks.brief.delivery, "empty");
  assert.equal(s.project(p).confirmed, false);
  const reopened = new Database(db.root);
  try {
    assert.equal(
      new StudioService(reopened)
        .project(p)
        .messages.find((m) => m.id === first)?.confirmation?.answeredBy,
      messages.at(-1)?.id,
    );
  } finally {
    reopened.close();
  }
});

test("single pending question resolves on a reply; failed and cross-project sends leave it pending", (t) => {
  const { s, p, db } = fixture(t);
  const question = s.message(
    p,
    "总控 AI",
    "coordinator",
    "希望制作几集？",
    undefined,
    undefined,
    { requiresReply: true },
  );
  const other = s.create("另一个剧本", "原文", []);
  const alien = s.project(other).messages[0].id;
  const runtime = new AiRuntime(s);
  assert.throws(() => runtime.queue(p, "回复", crypto.randomUUID(), alien));
  assert.equal(s.project(p).messages.length, 2);
  assert.equal(s.project(p).messages.at(-1)?.confirmation?.status, "pending");
  assert.throws(() =>
    s.message(p, "子 AI", "executor", "请确认", undefined, undefined, {
      requiresReply: true,
    }),
  );
  const run = runtime.queue(p, "先做三集", crypto.randomUUID());
  const replyId = s.project(p).messages.at(-1)?.id;
  assert.equal(
    s.project(p).messages.find((m) => m.id === question)?.confirmation
      ?.answeredBy,
    replyId,
  );
  const next = s.message(
    p,
    "总控 AI",
    "coordinator",
    "下一项确认",
    undefined,
    undefined,
    { requiresReply: true },
  );
  assert.throws(() => runtime.queue(p, "发送失败", crypto.randomUUID(), next));
  assert.equal(
    s.project(p).messages.find((m) => m.id === next)?.confirmation?.status,
    "pending",
  );
  db.run("UPDATE runs SET status='completed' WHERE id=?", run.id);
});

test("existing messages retain audience inference when upgrading schema", (t) => {
  const { db, s, p } = fixture(t);
  const id = s.message(
    p,
    "总控 AI",
    "coordinator",
    "@原作分析 AI 请分析",
    "source",
  );
  db.run("DELETE FROM message_details");
  db.run("PRAGMA user_version=1");
  const reopened = new Database(db.root);
  try {
    const actual = new StudioService(reopened).project(p);
    assert.equal(actual.messages.find((m) => m.id === id)?.audience, "agents");
    assert.equal(actual.messages.length, 2);
    assert.equal(
      reopened.one<{ user_version: number }>("PRAGMA user_version")
        ?.user_version,
      17,
    );
  } finally {
    reopened.close();
  }
});
function source(s: StudioService, p: string) {
  s.act(
    p,
    "source",
    { type: "save", text: "范围：全篇短故事；类型：小说。" },
    { role: "executor", taskId: "source" },
    0,
  );
  s.act(
    p,
    "source",
    { type: "review" },
    { role: "reviewer", taskId: "source" },
    1,
    "有原文依据",
  );
  s.act(p, "source", { type: "accept" }, coordinator, 1, "完成原作理解目标");
}
test("fresh persistence keeps separate original, output, review and discussion records across reopen", async (t) => {
  const { db, s, p } = fixture(t);
  const files = await storeUploads(db, [
    new File(["原文不可改写"], "故事.txt"),
  ]);
  const p2 = s.create("带文件", "我的偏好", files);
  assert.equal((await readMaterial(db, p2, files[0].id, 0, 2)).kind, "text");
  source(s, p);
  const reopened = new Database(db.root);
  try {
    const actual = new StudioService(reopened).project(p);
    assert.equal(actual.tasks.source.delivery, "approved");
    assert.equal(actual.messages.length, 1);
    assert.equal(actual.events.length, 3);
    assert.equal(actual.episodes.length, 0);
  } finally {
    reopened.close();
  }
});
test("review permission and stale revisions are enforced on server", (t) => {
  const { s, p } = fixture(t);
  s.act(p, "source", { type: "save", text: "初稿" }, human, 0);
  assert.throws(() =>
    s.act(
      p,
      "source",
      { type: "accept" },
      { role: "executor", taskId: "source" },
      1,
      "自己通过",
    ),
  );
  assert.throws(() =>
    s.act(p, "source", { type: "review" }, coordinator, 1, "自己审核"),
  );
  s.act(
    p,
    "source",
    { type: "review" },
    { role: "reviewer", taskId: "source" },
    1,
    "核对通过",
  );
  s.act(p, "source", { type: "save", text: "新稿" }, human, 1);
  assert.throws(() =>
    s.act(p, "source", { type: "accept" }, coordinator, 1, "旧稿通过"),
  );
  assert.throws(() =>
    s.act(p, "source", { type: "accept" }, coordinator, 2, "不能沿用审核"),
  );
  assert.equal(s.project(p).tasks.source.delivery, "draft");
  assert.equal(s.project(p).tasks.source.history[0].delivery, "reviewed");
});
test("failed and conflicting actions leave database unchanged", (t) => {
  const { s, p } = fixture(t);
  const before = s.project(p);
  assert.throws(() =>
    s.act(p, "script", { type: "save", text: "越过输入" }, human, 0),
  );
  assert.deepEqual(s.project(p), before);
  s.message(p, "你", "human", "另一设备消息");
  assert.throws(() =>
    s.act(
      p,
      "source",
      { type: "save", text: "过期修改" },
      human,
      0,
      "",
      before.version,
    ),
  );
  assert.equal(s.project(p).tasks.source.revision, 0);
});
test("latest plan needs post-proposal human confirmation and creates variable structure atomically", (t) => {
  const { s, p } = fixture(t);
  source(s, p);
  s.act(
    p,
    "brief",
    {
      type: "save",
      text: "用户确认：一条短片、20秒、横屏、真人、全篇、忠于原文",
    },
    coordinator,
    0,
  );
  s.act(p, "brief", { type: "accept" }, coordinator, 1, "用户明确确认");
  const plan = s.propose(p, { summary: "先确认骨架，由编剧确定分集" });
  assert.equal(s.project(p).confirmed, false);
  assert.equal(s.project(p).episodes.length, 0);
  assert.throws(() => s.confirmPlan(p, plan.id, s.project(p).messages[0].id));
  s.confirmPlan(p, plan.id);
  const project = s.project(p);
  assert.equal(project.episodes.length, 0);
  assert.deepEqual(Object.keys(project.tasks).sort(), [
    "brief",
    "script",
    "source",
  ]);
  assert.throws(() => s.confirmPlan(p, plan.id));
});
test("AI queue is idempotent and exclusive per project, crash does not replay", (t) => {
  const { s, p, db } = fixture(t);
  const runtime = new AiRuntime(s);
  const id = crypto.randomUUID();
  const first = runtime.queue(p, "你好", id);
  assert.equal(runtime.queue(p, "你好", id).id, first.id);
  assert.throws(() => runtime.queue(p, "重复请求", crypto.randomUUID()));
  db.run("UPDATE runs SET process_id=?", 2147483647);
  runtime.recover();
  assert.equal(s.project(p).run?.status, "interrupted");
  assert.equal(db.one<{ n: number }>("SELECT COUNT(*) n FROM runs")?.n, 1);
});
test("skipping reviewer remains an audit event and does not approve output", (t) => {
  const { s, p } = fixture(t);
  s.act(p, "source", { type: "save", text: "内容" }, human, 0);
  s.act(p, "source", { type: "toggle-review" }, human, 1);
  assert.equal(s.project(p).tasks.source.delivery, "draft");
  s.act(
    p,
    "source",
    { type: "accept" },
    coordinator,
    1,
    "已检查目标，内容审核由用户禁用",
  );
  assert.equal(s.project(p).tasks.source.delivery, "approved");
  assert.match(s.project(p).events[1].text, /跳过/);
});

test("media versions bind real files; approved assets and generated-frame lineage survive reopen", async (t) => {
  const { s, p, db } = fixture(t);
  source(s, p);
  const accept = (id: string) => {
    const task = s.project(p).tasks[id];
    if (task.reviewEnabled)
      s.act(
        p,
        id,
        { type: "review" },
        { role: "reviewer", taskId: id },
        task.revision,
        "对照输入检查",
      );
    s.act(p, id, { type: "accept" }, coordinator, task.revision, "目标已达成");
  };
  s.act(p, "brief", { type: "save", text: "确认需求" }, coordinator, 0);
  accept("brief");
  const plan = s.propose(p, { summary: "制作骨架" });
  s.confirmPlan(p, plan.id);
  s.act(
    p,
    "script",
    {
      type: "save",
      text: "整体剧本",
      structure: {
        kind: "episodes",
        representative: 1,
        reason: "代表性",
        items: [{ number: 1, title: "一", synopsis: "一", text: "本集剧本" }],
      },
    },
    human,
    0,
  );
  accept("script");
  s.act(
    p,
    "episode-1-storyboard",
    {
      type: "save",
      text: "本集分镜",
      structure: {
        kind: "shots",
        complete: true,
        representative: 1,
        reason: "代表性",
        items: [{ number: 1, title: "一镜", synopsis: "一", text: "镜头正文" }],
      },
    },
    human,
    0,
  );
  accept("episode-1-storyboard");
  const asset = "episode-1-shot-1-assets",
    frame = "episode-1-shot-1-frames";
  s.act(
    p,
    asset,
    {
      type: "save",
      text: "人物基准",
      reuseReason: "已查通过库，目前没有人物资产",
      assetName: "林川20岁",
      assetCategory: "人物",
    },
    human,
    0,
  );
  s.act(
    p,
    asset,
    { type: "review" },
    { role: "reviewer", taskId: asset },
    1,
    "暂无可复用项",
  );
  assert.throws(() =>
    s.act(
      p,
      asset,
      { type: "accept", imagesPresent: true },
      coordinator,
      1,
      "前端假报有图片",
    ),
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await storeUploads(db, [new File([png], "人物.png")]);
  s.act(p, asset, { type: "attach" }, human, 1, "", undefined, uploaded);
  assert.equal(s.project(p).tasks[asset].delivery, "draft");
  accept(asset);
  assert.equal(s.project(p).assets[0].id, "IMAGE-1-1");
  s.act(p, frame, { type: "save", text: "首帧与关键动作" }, human, 0);
  const frames = await storeUploads(db, [new File([png], "首帧.png")]);
  s.act(p, frame, { type: "attach" }, human, 1, "", undefined, frames);
  accept(frame);
  const result = s.snapshot();
  assert.deepEqual(
    result.state.projects[0].assets.find((a) => a.id === "FRAME-1-1")
      ?.sourceIds,
    ["IMAGE-1-1"],
  );
  assert.equal(result.files[`${p}/${asset}`][0].id, uploaded[0].id);
  assert.throws(() => s.act(p, frame, { type: "attach" }, human, 2));
  const video = "episode-1-shot-1-video";
  assert.throws(
    () => s.act(p, video, { type: "attach" }, human, 0),
    /真实文件/,
  );
  assert.throws(
    () => s.act(p, video, { type: "attach" }, human, 0, "", undefined, frames),
    /类型/,
  );
  const clip = await storeUploads(db, [
    new File(
      [new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109])],
      "clip.mp4",
      { type: "video/mp4" },
    ),
  ]);
  s.act(p, video, { type: "attach" }, human, 0, "", undefined, clip);
  const uploadedVideo = s.project(p).tasks[video];
  assert.equal(uploadedVideo.delivery, "draft");
  assert.match(uploadedVideo.text, /待核对/);
  assert.equal(
    s.outputFiles(p, video, uploadedVideo.revision)[0].id,
    clip[0].id,
  );
  assert.equal(s.project(p).tasks[video].history.length, 0);
  s.act(
    p,
    video,
    { type: "return", reason: "用户播放后反馈时长不符，需重新制作" },
    coordinator,
    uploadedVideo.revision,
  );
  assert.equal(s.project(p).tasks[video].delivery, "returned");
});

test("skip persists independently, is idempotent, and never answers or approves", (t) => {
  const { db, s, p } = fixture(t);
  const ask = (text: string) =>
    s.message(p, "总控 AI", "coordinator", text, undefined, undefined, {
      requiresReply: true,
    });
  const skipped = ask("这条建议需要采用吗？"),
    remaining = ask("希望什么风格？");
  const before = s.project(p);
  const notice = s.skipConfirmation(p, skipped);
  assert.equal(s.skipConfirmation(p, skipped), notice);
  assert.equal(
    db.one<{ n: number }>("SELECT COUNT(*) n FROM confirmation_skips")?.n,
    1,
  );
  const after = s.project(p);
  assert.equal(after.messages.length, before.messages.length);
  assert.equal(
    after.messages.find((m) => m.id === skipped)?.confirmation?.status,
    "skipped",
  );
  assert.equal(
    after.messages.find((m) => m.id === skipped)?.confirmation?.answeredBy,
    undefined,
  );
  assert.deepEqual(after.tasks, before.tasks);
  assert.equal(after.confirmed, false);
  const recorded = db.one<{ role: string; text: string }>(
    "SELECT role,text FROM messages WHERE id=?",
    notice,
  )!;
  assert.equal(recorded.role, "system");
  assert.match(recorded.text, /不代表同意/);
  s.message(p, "你", "human", "动画");
  assert.equal(
    s.project(p).messages.find((m) => m.id === remaining)?.confirmation?.status,
    "answered",
  );
  s.message(p, "你", "human", "另补充一点", undefined, undefined, {
    replyToId: skipped,
  });
  assert.equal(
    s.project(p).messages.find((m) => m.id === skipped)?.confirmation?.status,
    "skipped",
  );
  const reopened = new Database(db.root);
  try {
    const confirmation = new StudioService(reopened)
      .project(p)
      .messages.find((m) => m.id === skipped)?.confirmation;
    assert.equal(confirmation?.status, "skipped");
    assert.ok(confirmation?.skippedAt);
  } finally {
    reopened.close();
  }
});

test("skip rejects answered, ordinary and cross-project messages; works while AI is busy", (t) => {
  const { db, s, p } = fixture(t);
  const question = s.message(
    p,
    "总控 AI",
    "coordinator",
    "一个问题",
    undefined,
    undefined,
    { requiresReply: true },
  );
  const other = s.create("另一部", "原文", []);
  assert.throws(() => s.skipConfirmation(other, question), /找不到/);
  assert.throws(
    () => s.skipConfirmation(p, s.project(p).messages[0].id),
    /找不到/,
  );
  assert.equal(
    db.one<{ n: number }>("SELECT COUNT(*) n FROM confirmation_skips")?.n,
    0,
  );
  s.message(p, "你", "human", "回答", undefined, undefined, {
    replyToId: question,
  });
  assert.throws(() => s.skipConfirmation(p, question), /已经回复/);
  const next = s.message(
    p,
    "总控 AI",
    "coordinator",
    "下一项",
    undefined,
    undefined,
    { requiresReply: true },
  );
  const runtime = new AiRuntime(s);
  const run = runtime.queueInitial(p);
  s.skipConfirmation(p, next);
  assert.equal(
    s.project(p).messages.find((m) => m.id === next)?.confirmation?.status,
    "skipped",
  );
  assert.equal(
    db.one<{ status: string }>("SELECT status FROM runs WHERE id=?", run)
      ?.status,
    "queued",
  );
});
