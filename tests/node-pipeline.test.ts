import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { NodeBatchYield, NodePipeline } from "../src/server/ai/node-pipeline";
import { rawConversations } from "../src/server/ai/raw-conversations";
import { planSchema } from "../src/server/contracts";
import type { OutputStructure } from "../src/domain/expansion";
const rootActor = { role: "coordinator" as const };
function fixture(t: any) {
  const folder = mkdtempSync(path.join(tmpdir(), "drama-routing-")),
    db = new Database(folder),
    s = new StudioService(db),
    p = s.create("流程测试", "原文", []);
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES('parent',?,'running',?,?)",
    p,
    process.pid,
    new Date().toISOString(),
  );
  const pipeline = new NodePipeline(s);
  return {
    db,
    s,
    p,
    pipeline,
    start: () => pipeline.start(p, "source", "理解原作", "parent"),
  };
}
test("system routes rejection and rework privately then returns only reviewed version", async (t) => {
  const { s, p, pipeline, start } = fixture(t),
    job = start(),
    actors: string[] = [];
  const result = await pipeline.drive(
    p,
    job,
    "理解原作",
    async (actor, instruction) => {
      actors.push(actor.role);
      const current = s.project(p).tasks.source;
      if (actor.role === "executor")
        s.act(
          p,
          "source",
          {
            type: "save",
            text: current.revision ? "修正范围和事实" : "第一版",
          },
          actor,
          current.revision,
        );
      else
        s.act(
          p,
          "source",
          current.revision === 1
            ? { type: "return", reason: "缺少阅读范围" }
            : { type: "review" },
          actor,
          current.revision,
          "已核对阅读依据",
        );
      return "内部回复不进群";
    },
  );
  assert.deepEqual(actors, ["executor", "reviewer", "executor", "reviewer"]);
  assert.equal(result.status, "submitted");
  assert.equal(s.project(p).tasks.source.delivery, "reviewed");
  assert.equal(s.project(p).tasks.source.revision, 2);
  assert.equal(
    s.project(p).messages.some((m) => m.text.includes("内部回复不进群")),
    false,
  );
  assert.equal(
    s.project(p).messages.find((m) => m.execution)?.execution?.status,
    "submitted",
  );
  s.act(p, "source", { type: "accept" }, rootActor, 2, "符合目标");
  assert.equal(
    s.project(p).messages.find((m) => m.execution)?.execution?.status,
    "completed",
  );
});
test("questions go through reviewer to coordinator, explicit answer resumes original node", async (t) => {
  const { s, p, pipeline, start } = fixture(t),
    job = start();
  let question = "";
  const waiting = await pipeline.drive(p, job, "开始", async (actor) => {
    if (actor.role === "executor")
      question = pipeline.question(
        p,
        job,
        actor,
        "只做中段，需要保留哪些前情？",
      ).questionId;
    else
      pipeline.decide(p, job, actor, question, true, "影响用户选择的制作范围");
    return "";
  });
  assert.equal(waiting.status, "waiting");
  assert.equal(s.project(p).tasks.source.revision, 0);
  assert.throws(() => start(), /answer_question/);
  assert.throws(() => pipeline.answer("other", question, "答复", "parent"));
  const resume = pipeline.answer(p, question, "只补充相遇背景", "parent");
  assert.throws(() => pipeline.answer(p, question, "重复", "parent"));
  const done = await pipeline.drive(
    p,
    resume.jobId,
    resume.instruction,
    async (actor, input) => {
      if (actor.role === "executor") {
        assert.match(input, /只补充相遇背景/);
        s.act(p, "source", { type: "save", text: "补充背景的分析" }, actor, 0);
      } else s.act(p, "source", { type: "review" }, actor, 1, "依据完整");
      return "";
    },
  );
  assert.equal(done.status, "submitted");
});
test("reviewer can decline escalation with reasons; disabled review is skipped", async (t) => {
  const { s, p, pipeline, start } = fixture(t),
    job = start();
  let question = "",
    runs = 0;
  await pipeline.drive(p, job, "开始", async (actor, input) => {
    if (actor.role === "executor") {
      if (!runs++)
        question = pipeline.question(
          p,
          job,
          actor,
          "是否需要标明未读范围？",
        ).questionId;
      else {
        assert.match(input, /已有规则要求/);
        s.act(p, "source", { type: "save", text: "范围已标明" }, actor, 0);
      }
    } else if (pipeline.pending(job))
      pipeline.decide(
        p,
        job,
        actor,
        question,
        false,
        "已有规则要求标明，无需用户决定",
      );
    else s.act(p, "source", { type: "review" }, actor, 1, "范围完整");
    return "";
  });
  assert.equal(
    s.project(p).messages.some((m) => m.text.includes("是否需要标明")),
    false,
  );
  s.act(
    p,
    "source",
    { type: "return", reason: "需要另一种概况" },
    rootActor,
    1,
  );
  s.act(p, "source", { type: "toggle-review" }, rootActor, 1);
  const next = start();
  const roles: string[] = [];
  await pipeline.drive(p, next, "修改", async (actor) => {
    roles.push(actor.role);
    s.act(p, "source", { type: "save", text: "新概况" }, actor, 1);
    return "";
  });
  assert.deepEqual(roles, ["executor"]);
  assert.equal(s.project(p).tasks.source.delivery, "draft");
  s.act(p, "source", { type: "accept" }, rootActor, 2, "核对目标");
  assert.ok(s.project(p).events.some((e) => e.action === "review-skipped"));
});
test("a saved draft can enter content review after a declined question without inventing a revision", async (t) => {
  const { s, p, pipeline, start } = fixture(t), job = start();
  let productions = 0, question = "", contentReviews = 0;
  const result = await pipeline.drive(p, job, "开始", async (actor, instruction) => {
    if (actor.role === "executor") {
      if (!productions++) {
        s.act(p, "source", { type: "save", text: "已保存，待实际内容审核" }, actor, 0);
        question = pipeline.question(p, job, actor, "已有产出是否需要总控先判断细节？").questionId;
      } else {
        assert.match(instruction, /无需上报/);
        assert.equal(s.project(p).tasks.source.revision, 1);
        // Producer submits the existing draft, without a cosmetic save or regeneration.
      }
    } else if (pipeline.pending(job)) {
      pipeline.decide(p, job, actor, question, false, "既定范围内的问题，进入正常内容审核");
    } else {
      contentReviews++;
      s.act(p, "source", { type: "review" }, actor, 1, "实际内容已检查，符合既定范围");
    }
    return "";
  });
  assert.equal(result.status, "submitted");
  assert.equal(contentReviews, 1);
  assert.equal(s.project(p).tasks.source.revision, 1);
  assert.equal(s.project(p).tasks.source.delivery, "reviewed");
});

test("technical stop without a new output pauses after one producer turn, preserving previous rejection", async (t) => {
  const { s, p, db, pipeline, start } = fixture(t);
  const job = start();
  s.act(
    p,
    "source",
    { type: "save", text: "已保存的旧版" },
    { role: "executor", taskId: "source" },
    0,
  );
  s.act(
    p,
    "source",
    { type: "return", reason: "需要补充" },
    { role: "reviewer", taskId: "source" },
    1,
  );
  const roles: string[] = [];
  const result = await pipeline.drive(p, job, "修复后继续", async (actor) => {
    roles.push(actor.role);
    return "工具失败，未保存新版，停止重试";
  });
  assert.equal(result.status, "paused");
  assert.deepEqual(roles, ["executor"]);
  assert.match(pipeline.job(p, job).error, /未保存新版/);
  assert.doesNotMatch(pipeline.job(p, job).error, /4轮/);
  assert.equal(
    db.all("SELECT * FROM reviews WHERE decision='return'").length,
    1,
  );
  assert.equal(s.project(p).tasks.source.revision, 1);
});

test("answer with pause records the coordinator decision without resuming production or review", async (t) => {
  const { s, p, db, pipeline, start } = fixture(t);
  const job = start();
  const q = pipeline.question(
    p,
    job,
    { role: "executor", taskId: "source" },
    "工具阻塞",
  );
  pipeline.decide(
    p,
    job,
    { role: "reviewer", taskId: "source" },
    q.questionId,
    true,
    "需要技术修复",
  );
  pipeline.set(job, "waiting");
  assert.throws(
    () => pipeline.answer(p, q.questionId, "停止", "parent", true, true),
    /不能同时/,
  );
  assert.equal(pipeline.pending(job)?.status, "escalated");
  const continuation = pipeline.answer(
    p,
    q.questionId,
    "等待权限修复，保留产出",
    "parent",
    false,
    true,
  );
  assert.equal(continuation.paused, true);
  assert.equal(pipeline.job(p, job).status, "paused");
  assert.equal(pipeline.pending(job), undefined);
  assert.equal(db.all("SELECT * FROM reviews").length, 0);
  assert.equal(
    s.project(p).events.filter((e) => e.action === "pause-after-answer").length,
    1,
  );
  assert.throws(
    () => pipeline.answer(p, q.questionId, "重复答复", "parent", false, true),
    /只能回答/,
  );
});

test("endless rework pauses without approval; disabled task stops before review", async (t) => {
  const { s, p, db, pipeline, start } = fixture(t);
  const result = await pipeline.drive(p, start(), "开始", async (actor) => {
    const current = s.project(p).tasks.source;
    s.act(
      p,
      "source",
      actor.role === "executor"
        ? { type: "save", text: "仍需修改" }
        : { type: "return", reason: "缺少依据" },
      actor,
      current.revision,
    );
    return "";
  });
  assert.equal(result.status, "paused");
  assert.equal(s.project(p).tasks.source.delivery, "returned");
  assert.throws(start, /连续退回4次/);
  db.run("UPDATE runs SET status='completed' WHERE id='parent'");
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES('next-user-round',?,'running',?,?)",
    p,
    process.pid,
    new Date(Date.now() + 1).toISOString(),
  );
  const job = pipeline.start(
    p,
    "source",
    "用户调整要求后继续",
    "next-user-round",
  );
  await pipeline.drive(p, job, "继续", async (actor) => {
    assert.equal(actor.role, "executor");
    s.act(p, "source", { type: "toggle-executor" }, rootActor, 4);
    return "";
  });
  assert.equal(pipeline.job(p, job).status, "paused");
});

function approve(s: StudioService, p: string, id: string) {
  const task = s.project(p).tasks[id];
  if (task.reviewEnabled)
    s.act(
      p,
      id,
      { type: "review" },
      { role: "reviewer", taskId: id },
      task.revision,
      "检查正文与结构",
    );
  s.act(p, id, { type: "accept" }, rootActor, task.revision, "符合要求");
}
function setup(s: StudioService, p: string) {
  s.act(
    p,
    "source",
    { type: "save", text: "原作理解" },
    { role: "executor", taskId: "source" },
    0,
  );
  approve(s, p, "source");
  s.act(
    p,
    "brief",
    { type: "save", text: "用户希望5集，原作中段" },
    rootActor,
    0,
  );
  approve(s, p, "brief");
  s.confirmPlan(
    p,
    s.propose(p, {
      summary: "原作理解 → 制作需求 → 整体剧本 → 按产出展开 → 归档",
    }).id,
  );
}
const structure = (
  kind: "episodes" | "shots",
  numbers: number[],
  representative: number,
): OutputStructure => ({
  kind,
  representative,
  reason: "检验核心风格与人物",
  items: numbers.map((n) => ({
    number: n,
    title: `内容${n}`,
    synopsis: `摘要${n}`,
    text: `正式正文${n}`,
  })),
});
test("accepted version expands populated episodes then shots, append preserves existing outputs", (t) => {
  const { s, p, db } = fixture(t);
  setup(s, p);
  assert.equal(s.project(p).episodes.length, 0);
  assert.throws(() =>
    s.act(p, "script", { type: "save", text: "越权" }, rootActor, 0),
  );
  assert.equal(
    planSchema.safeParse({ summary: "骨架", episodes: [] }).success,
    false,
  );
  s.act(
    p,
    "script",
    {
      type: "save",
      text: "分集剧本",
      structure: structure("episodes", [1, 2, 3, 4, 5], 3),
    },
    { role: "executor", taskId: "script" },
    0,
  );
  assert.equal(s.project(p).episodes.length, 0);
  approve(s, p, "script");
  assert.equal(s.project(p).episodes.length, 5);
  assert.equal(s.project(p).representativeEpisode, 3);
  assert.equal(
    Object.values(s.project(p).tasks).filter((t) => t.kind === "board").length,
    0,
  );
  const id = "episode-3-storyboard",
    actor = { role: "executor" as const, taskId: id };
  assert.throws(() =>
    s.act(
      p,
      id,
      { type: "save", text: "越界", structure: structure("episodes", [1], 1) },
      actor,
      0,
    ),
  );
  s.act(
    p,
    id,
    {
      type: "save",
      text: "先做关键镜头",
      structure: structure("shots", [4], 4),
    },
    actor,
    0,
  );
  approve(s, p, id);
  assert.equal(
    Object.values(s.project(p).tasks).filter((t) => t.kind === "board").length,
    1,
  );
  assert.equal(
    s.project(p).tasks["episode-3-shot-4-board"].delivery,
    "approved",
  );
  s.act(
    p,
    id,
    {
      type: "save",
      text: "继续其他镜头",
      structure: structure("shots", [1, 2, 3, 4, 5], 4),
    },
    actor,
    1,
  );
  approve(s, p, id);
  assert.equal(s.project(p).tasks["episode-3-shot-4-board"].revision, 1);
  assert.equal(s.project(p).tasks["episode-3-assembly"].dependencies.length, 6);
  const bad = structure("shots", [4, 6], 4);
  bad.items[0].text = "试图重写关键镜头";
  s.act(
    p,
    id,
    { type: "save", text: "有冲突的增补", structure: bad },
    actor,
    2,
  );
  s.act(
    p,
    id,
    { type: "review" },
    { role: "reviewer", taskId: id },
    3,
    "内容审核",
  );
  assert.throws(
    () => s.act(p, id, { type: "accept" }, rootActor, 3, "验收"),
    /不能覆盖/,
  );
  assert.equal(s.project(p).tasks["episode-3-shot-6-board"], undefined);
  assert.equal(s.project(p).tasks[id].delivery, "reviewed");
  const reopened = new Database(db.root);
  try {
    assert.equal(
      new StudioService(reopened).project(p).tasks["episode-3-shot-4-board"]
        .delivery,
      "approved",
    );
  } finally {
    reopened.close();
  }
});
test("raw sessions are project-isolated and legacy sessions are not fabricated", (t) => {
  const { s, p, db } = fixture(t),
    other = s.create("其他", "资料", []);
  db.run(
    "INSERT INTO sessions(id,project_id,scope,role) VALUES('legacy',?,'source','executor')",
    p,
  );
  assert.equal((rawConversations(db, p).sessions as any[])[0].count, 0);
  assert.deepEqual(rawConversations(db, p, "legacy").events, []);
  assert.throws(() => rawConversations(db, other, "legacy"));
});
import { productionTasks } from "../src/domain/structure";
import { missingInputs } from "../src/domain/queries";

test("v4 empty scaffolding stays hidden while real output survives and can be expanded", (t) => {
  const { s, p, db } = fixture(t);
  setup(s, p);
  const episodes = [{ number: 1, title: "旧规划", synopsis: "占位", shots: 2 }];
  db.run("INSERT INTO episodes VALUES(?,?,?,?,?)", p, 1, "旧规划", "占位", 2);
  for (const task of productionTasks(episodes)) {
    db.run(
      "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)",
      p,
      task.id,
      task.kind,
      task.title,
      task.objective,
      task.episode ?? null,
      task.shot ?? null,
      1,
      +task.reviewEnabled,
    );
    for (const dep of task.dependencies)
      db.run("INSERT INTO dependencies VALUES(?,?,?)", p, task.id, dep);
  }
  db.run("PRAGMA user_version=4");
  const upgraded = new Database(db.root);
  try {
    const service = new StudioService(upgraded);
    assert.equal(service.project(p).tasks["episode-1"].placeholder, true);
    assert.equal(service.project(p).tasks.source.text, "原作理解");
    assert.equal(service.project(p).tasks.source.delivery, "approved");
    assert.throws(
      () =>
        service.act(
          p,
          "episode-1",
          { type: "save", text: "非法直接填充" },
          { role: "executor", taskId: "episode-1" },
          0,
        ),
      /空占位/,
    );
    service.act(
      p,
      "script",
      {
        type: "save",
        text: "正式剧本",
        structure: structure("episodes", [1], 1),
      },
      { role: "executor", taskId: "script" },
      0,
    );
    approve(service, p, "script");
    assert.equal(service.project(p).tasks["episode-1"].placeholder, false);
    service.act(
      p,
      "episode-1-storyboard",
      { type: "save", text: "代表镜头", structure: structure("shots", [1], 1) },
      { role: "executor", taskId: "episode-1-storyboard" },
      0,
    );
    approve(service, p, "episode-1-storyboard");
    const project = service.project(p);
    assert.equal(project.tasks["episode-1-shot-1-board"].placeholder, false);
    assert.equal(project.tasks["episode-1-shot-2-board"].placeholder, true);
    assert.deepEqual(
      project.tasks["episode-1-assembly"].dependencies.sort(),
      ["episode-1-storyboard", "episode-1-shot-1-video"].sort(),
    );
    assert.ok(
      missingInputs(project, project.tasks["episode-1-assembly"]).some(
        (t) => t.kind === "storyboard",
      ),
    );
  } finally {
    upgraded.close();
  }
});

test("interrupted pending question resumes review without regenerating or duplicating public question", async (t) => {
  const { s, p, pipeline, start } = fixture(t);
  const job = start();
  pipeline.question(
    p,
    job,
    { role: "executor", taskId: "source" },
    "范围待确认",
  );
  pipeline.set(job, "failed", "中断");
  assert.equal(start(), job);
  const runner = async (actor: any) => {
    assert.equal(actor.role, "reviewer");
    pipeline.decide(
      p,
      job,
      actor,
      pipeline.pending(job)!.id,
      true,
      "需用户决定",
    );
    return "";
  };
  await pipeline.drive(p, job, "恢复", runner);
  pipeline.set(job, "paused");
  assert.equal(start(), job);
  await pipeline.drive(p, job, "恢复", async () => {
    throw new Error("已转交不应再执行");
  });
  assert.equal(
    s.project(p).messages.filter((m) => m.text === "范围待确认").length,
    1,
  );
});

import { AiRuntime } from "../src/server/ai/runtime";
test("recovering an existing reviewed delivery is idempotent and never impersonates the user", async (t) => {
  const { s, p, db, pipeline, start } = fixture(t);
  const job = start();
  await pipeline.drive(p, job, "分析", async (actor) => {
    s.act(
      p,
      "source",
      actor.role === "executor"
        ? { type: "save", text: "保留的分析" }
        : { type: "review" },
      actor,
      actor.role === "executor" ? 0 : 1,
      "核对完成",
    );
    return "";
  });
  db.run("UPDATE runs SET status='completed' WHERE id='parent'");
  const runtime = new AiRuntime(s);
  const before = s.project(p).messages.filter((m) => m.sender === "你").length;
  const first = runtime.queueDelivery(p, job),
    second = runtime.queueDelivery(p, job);
  assert.equal(first.id, second.id);
  assert.equal(second.created, false);
  assert.equal(
    s.project(p).messages.filter((m) => m.sender === "你").length,
    before,
  );
  assert.equal(
    db.one<{ role: string }>(
      "SELECT role FROM messages WHERE project_id=? ORDER BY seq DESC LIMIT 1",
      p,
    )!.role,
    "system",
  );
  assert.equal(s.project(p).tasks.source.delivery, "reviewed");
  assert.equal(s.project(p).tasks.source.revision, 1);
  assert.throws(
    () => runtime.queue(p, "同时推进", crypto.randomUUID()),
    /正在处理/,
  );
});

test("accepted source report can be supplemented through a fresh review without changing confirmed brief", async (t) => {
  const { s, p, db, pipeline, start } = fixture(t);
  setup(s, p);
  const brief = s.project(p).tasks.brief;
  const job = start();
  assert.ok(
    missingInputs(s.project(p), s.project(p).tasks.script).some(
      (t) => t.id === "source",
    ),
  );
  assert.throws(
    () => pipeline.start(p, "script", "不该提前编剧", "parent"),
    /尚未验收/,
  );
  const roles: string[] = [];
  await pipeline.drive(p, job, "仅补读案件缺口", async (actor) => {
    roles.push(actor.role);
    const current = s.project(p).tasks.source;
    if (actor.role === "executor")
      s.act(
        p,
        "source",
        { type: "save", text: "原作理解；补齐案件证据链" },
        actor,
        current.revision,
      );
    else
      s.act(
        p,
        "source",
        { type: "review" },
        actor,
        current.revision,
        "已核实新增依据",
      );
    return "";
  });
  assert.deepEqual(roles, ["executor", "reviewer"]);
  let project = s.project(p);
  assert.equal(project.tasks.source.revision, 2);
  assert.equal(project.tasks.source.delivery, "reviewed");
  assert.equal(project.tasks.source.history[0].text, "原作理解");
  assert.equal(project.tasks.source.history[0].delivery, "approved");
  assert.deepEqual(project.tasks.brief, brief);
  assert.ok(
    missingInputs(project, project.tasks.script).some((t) => t.id === "source"),
  );
  assert.throws(
    () =>
      s.act(
        p,
        "source",
        { type: "accept" },
        { role: "coordinator" },
        1,
        "旧审核不算",
      ),
    /版本已变化/,
  );
  s.act(
    p,
    "source",
    { type: "accept" },
    { role: "coordinator" },
    2,
    "补读范围满足目标",
  );
  project = s.project(p);
  assert.equal(missingInputs(project, project.tasks.script).length, 0);
  assert.equal(
    project.messages.find((m) => m.execution)?.execution?.status,
    "completed",
  );
  assert.equal(
    db.one<{ n: number }>(
      "SELECT count(*) n FROM reviews WHERE project_id=? AND task_id='source' AND revision=1",
      p,
    )!.n,
    2,
  );
});

test("batch checkpoint survives reopening, resumes reviewer without regenerating answered work", async (t) => {
  const { s, p, db, pipeline, start } = fixture(t);
  const job = start();
  let produced = 0;
  const yielded = await pipeline.drive(
    p,
    job,
    "问题：范围？\n总控答复：只做开头",
    async (actor) => {
      if (actor.role === "reviewer") throw new NodeBatchYield(actor.role);
      produced++;
      s.act(p, "source", { type: "save", text: "只做开头的分析" }, actor, 0);
      return "";
    },
  );
  assert.equal(yielded.status, "continuing");
  assert.equal(s.project(p).tasks.source.delivery, "draft");
  assert.throws(start, /正在执行/);
  const reopened = new Database(db.root);
  try {
    const resumed = new NodePipeline(new StudioService(reopened));
    const result = await resumed.drive(p, job, "", async (actor) => {
      assert.equal(actor.role, "reviewer");
      s.act(p, "source", { type: "review" }, actor, 1, "独立核对开头范围");
      return "";
    });
    assert.equal(result.status, "submitted");
    assert.equal(produced, 1);
    assert.equal(s.project(p).tasks.source.delivery, "reviewed");
    assert.equal(
      reopened.one<{ status: string }>(
        "SELECT status FROM node_checkpoints WHERE job_id=?",
        job,
      )!.status,
      "resumed",
    );
  } finally {
    reopened.close();
  }
});

test("batch rotation never resets node rework limit or bypasses disabled tasks", async (t) => {
  const { s, p, pipeline, start } = fixture(t);
  const job = start();
  let status = "",
    produced = 0,
    reviewed = 0;
  for (let batch = 0; batch < 10; batch++) {
    let used = 0;
    const result = await pipeline.drive(p, job, "分析", async (actor) => {
      if (used++) throw new NodeBatchYield(actor.role);
      const current = s.project(p).tasks.source;
      if (actor.role === "executor") {
        produced++;
        s.act(
          p,
          "source",
          { type: "save", text: "缺少证据" },
          actor,
          current.revision,
        );
      } else {
        reviewed++;
        s.act(
          p,
          "source",
          { type: "return", reason: "缺少依据" },
          actor,
          current.revision,
        );
      }
      return "";
    });
    status = result.status;
    if (status !== "continuing") break;
  }
  assert.equal(status, "paused");
  assert.equal(produced, 4);
  assert.equal(reviewed, 4);
  assert.throws(start, /连续退回4次/);
  assert.equal(s.project(p).tasks.source.delivery, "returned");
});

test("disabled node at a scheduling checkpoint stays paused and does not execute", async (t) => {
  const { s, p, pipeline, start } = fixture(t),
    job = start();
  await pipeline.drive(p, job, "分析", async (actor) => {
    throw new NodeBatchYield(actor.role);
  });
  s.act(p, "source", { type: "toggle-executor" }, rootActor, 0);
  const result = await pipeline.drive(p, job, "", async () => {
    assert.fail("disabled node ran");
  });
  assert.equal(result.status, "paused");
  assert.equal(s.project(p).tasks.source.revision, 0);
});

test("repair for the legacy batch cap is idempotent and does not invent user approval", (t) => {
  const { s, p, db, pipeline, start } = fixture(t),
    job = start();
  pipeline.set(job, "failed", "本轮执行数量已达上限，任务保留，下一轮继续");
  db.run("UPDATE runs SET status='completed' WHERE id='parent'");
  const runtime = new AiRuntime(s),
    first = runtime.queueBudgetRecovery(p, job),
    second = runtime.queueBudgetRecovery(p, job);
  assert.equal(first.id, second.id);
  assert.equal(second.created, false);
  assert.equal(
    s.project(p).messages.filter((m) => m.sender === "你").length,
    1,
  );
  assert.equal(s.project(p).tasks.source.delivery, "empty");
  assert.equal(
    db.one<{ role: string }>(
      "SELECT role FROM messages WHERE project_id=? ORDER BY seq DESC LIMIT 1",
      p,
    )!.role,
    "system",
  );
});
