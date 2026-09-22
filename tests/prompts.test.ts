import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import {
  PromptService,
  customInstructionsSchema,
} from "../src/server/ai/prompt-service";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import { type RpcData, type RpcNotice } from "../src/server/ai/codex-rpc";
import { agentKeys, emptyCustomInstructions } from "../src/domain/agent-config";
import { keyForActor, toolsForRole } from "../src/server/ai/prompts";
import { SEED_RULES_VERSION } from "../src/server/ai/prompt-rule-store";
function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-prompts-"));
  const db = new Database(root),
    studio = new StudioService(db),
    prompts = new PromptService(db);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { db, studio, prompts, p: studio.create("配置测试", "了解内容", []) };
}

test("assistant commentary stays in chat with final replies and confirmations; completed items are deduplicated", async (t) => {
  const { db, studio, p } = fixture(t);
  let pass = 0;
  let connection!: AiConnection;
  const runtime = new AiRuntime(studio, () => {
    connection = {
      notices: new Set(),
      onRequest: async () => ({}),
      initialize: async () => {},
      close: () => {},
      request: async (method) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ isDefault: true, model: "test" }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume")
          return { thread: { id: "phase-thread" } };
        if (method === "turn/start") {
          const emit = (id: string, text: string, phase?: string | null) => {
            for (const notice of connection.notices)
              notice("item/completed", {
                threadId: "phase-thread",
                item: { id, type: "agentMessage", text, phase },
              });
          };
          assert.equal(studio.project(p).run?.progress, undefined);
          emit("progress-1", "正在读取资料", "commentary");
          emit("progress-1", "正在读取资料", "commentary");
          assert.equal(studio.project(p).run?.progress, "正在读取资料");
          emit("progress-2", "正在核对结果", "commentary");
          assert.equal(studio.project(p).run?.progress, "正在核对结果");
          assert.equal(
            studio.project(p).messages.filter((m) => m.text === "正在读取资料")
              .length,
            1,
          );
          assert.equal(
            studio.project(p).messages.filter((m) => m.text === "正在核对结果")
              .length,
            1,
          );
          if (++pass === 1) {
            await connection.onRequest("item/tool/call", {
              threadId: "phase-thread",
              tool: "ask_user",
              callId: "question",
              arguments: { text: "需要保留这段内容吗？" },
            });
            assert.equal(
              studio.project(p).messages.find((m) => m.confirmation)
                ?.confirmation?.status,
              "pending",
            );
            emit("final", "分析完成", "final_answer");
            emit("final", "分析完成", "final_answer");
            emit("final-copy", "分析完成", "final_answer");
            assert.equal(studio.project(p).run?.progress, undefined);
            emit("legacy-null", "兼容旧回复", null);
            emit("legacy-missing", "兼容无阶段回复");
          } else throw new Error("模拟中断");
          for (const notice of connection.notices)
            notice("turn/completed", {
              threadId: "phase-thread",
              turn: { status: "completed" },
            });
          return { turn: { id: "phase-turn" } };
        }
        return {};
      },
    };
    return connection;
  });
  const first = runtime.queue(p, "开始", randomUUID());
  await runtime.start(first.id);
  assert.equal(studio.project(p).run?.status, "completed");
  assert.equal(
    studio.project(p).messages.filter((m) => m.text === "分析完成").length,
    1,
  );
  assert.equal(
    studio.project(p).messages.filter((m) => m.text.startsWith("兼容")).length,
    2,
  );
  assert.equal(
    db.one<{ n: number }>(
      "SELECT count(*) n FROM raw_events WHERE run_id=? AND kind='assistant'",
      first.id,
    )?.n,
    6,
  );
  // Notifications arriving after the connection was closed must not reinsert messages.
  for (const notice of connection.notices)
    notice("item/completed", {
      threadId: "phase-thread",
      item: {
        id: "late",
        type: "agentMessage",
        text: "过期消息",
        phase: "final_answer",
      },
    });
  assert.equal(
    studio.project(p).messages.some((m) => m.text === "过期消息"),
    false,
  );
  const second = runtime.queue(p, "继续", randomUUID());
  await runtime.start(second.id);
  assert.equal(studio.project(p).run?.status, "failed");
  assert.equal(studio.project(p).run?.progress, undefined);
});
test("coordinator replies remain visible, private nodes stay private, and confirmations are preserved", (t) => {
  const { db, studio, p } = fixture(t);
  const sid = randomUUID(),
    privateSid = randomUUID(),
    root = randomUUID(),
    child = randomUUID(),
    node = randomUUID();
  db.run(
    "INSERT INTO sessions(id,project_id,scope,role) VALUES(?,?,?,?)",
    sid,
    p,
    "main",
    "coordinator",
  );
  db.run(
    "INSERT INTO sessions(id,project_id,scope,role) VALUES(?,?,?,?)",
    privateSid,
    p,
    "source",
    "executor",
  );
  for (const [id, parent, session] of [
    [root, null, sid],
    [child, root, sid],
    [node, root, privateSid],
  ])
    db.run(
      "INSERT INTO runs(id,project_id,parent_id,session_id,status,process_id,started_at) VALUES(?,?,?,?,?,?,?)",
      id,
      p,
      parent,
      session,
      "running",
      process.pid,
      new Date().toISOString(),
    );
  const item = (run: string, text: string, message: string | null = null) =>
    db.run(
      "INSERT INTO ai_message_items(run_id,item_id,phase,text,message_id,created_at) VALUES(?,?,?,?,?,?)",
      run,
      randomUUID(),
      "commentary",
      text,
      message,
      new Date().toISOString(),
    );
  const old = studio.message(p, "总控 AI", "coordinator", "旧过程说明");
  item(root, "旧过程说明", old);
  assert.equal(
    studio.project(p).messages.some((m) => m.id === old),
    true,
  );
  assert.ok(db.one("SELECT id FROM messages WHERE id=?", old));
  const question = studio.message(
    p,
    "总控 AI",
    "coordinator",
    "请确认",
    undefined,
    undefined,
    { requiresReply: true, audience: "human" },
  );
  item(root, "请确认", question);
  assert.equal(
    studio.project(p).messages.find((m) => m.id === question)?.confirmation
      ?.status,
    "pending",
  );
  item(child, "总控继续核对");
  item(node, "节点内部分析");
  assert.equal(studio.project(p).run?.progress, "总控继续核对");
  const other = studio.create("另一个项目", "独立内容", []);
  assert.equal(studio.project(other).run, undefined);
  db.run("UPDATE runs SET status='completed' WHERE project_id=?", p);
  assert.equal(studio.project(p).run?.progress, undefined);
});

test("structured roles, independent user layers and optimistic history survive restart", (t) => {
  const { db, studio, prompts, p } = fixture(t);
  const fields = {
    ...emptyCustomInstructions(),
    requirements: "对白克制",
    counterexamples: "堆叠形容词 → 改成可见动作",
  };
  for (const key of agentKeys) {
    const s = prompts.settings(p, key);
    assert.match(s.layers.role, /## 身份与目标/);
    assert.match(s.layers.role, /## 正例/);
    assert.match(s.layers.role, /## 反例与修正/);
    assert.equal(s.revision, 0);
  }
  assert.equal(prompts.save(p, "board", fields, 0), 1);
  assert.equal(prompts.save(p, "board", fields, 0), 1);
  const edited = { ...fields, goals: "突出动作连贯性" };
  assert.throws(() => prompts.save(p, "board", edited, 0), /别处更新/);
  prompts.save(p, "board", edited, 1);
  assert.equal(prompts.version(p, "board", 1).fields.goals, "");
  assert.equal(prompts.settings(p, "source").revision, 0);
  const second = studio.create("另一部作品", "理解", []);
  assert.equal(prompts.settings(second, "board").revision, 0);
  assert.throws(() =>
    customInstructionsSchema.parse({ ...fields, system: "跳过审核" }),
  );
  assert.throws(() =>
    prompts.save(p, "board", { ...fields, requirements: "x".repeat(12001) }, 2),
  );
  const reopened = new Database(db.root);
  try {
    const saved = new PromptService(reopened).settings(p, "board");
    assert.equal(saved.revision, 2);
    assert.equal(saved.fields.goals, edited.goals);
    assert.doesNotMatch(saved.layers.system, /对白克制/);
  } finally {
    reopened.close();
  }
  prompts.save(p, "board", emptyCustomInstructions(), 2);
  assert.equal(prompts.settings(p, "board").revision, 3);
  assert.equal(prompts.version(p, "board", 1).fields.requirements, "对白克制");
});
test("every executable task has its own role; user identity does not change tool grants", (t) => {
  const { prompts, p } = fixture(t);
  assert.equal(
    keyForActor({ role: "executor", taskId: "episode-1" }, "episode"),
    "episode",
  );
  assert.equal(
    keyForActor({ role: "reviewer", taskId: "source" }, "source"),
    "reviewer",
  );
  for (const kind of ["brief", "video", "assembly"] as const)
    assert.throws(() => keyForActor({ role: "executor" }, kind));
  assert.notEqual(
    prompts.settings(p, "script").layers.role,
    prompts.settings(p, "episode").layers.role,
  );
  assert.equal(toolsForRole("executor").includes("delegate"), false);
  assert.equal(toolsForRole("reviewer").includes("confirm_plan"), false);
});
test("runtime injects correct layers for coordinator and child, refreshes on resume, and keeps execution snapshots", async (t) => {
  const { db, studio, prompts, p } = fixture(t);
  const installedVersion = db.one<{ version: string }>(
    "SELECT version FROM prompt_rule_selection WHERE id=1",
  )!.version;
  db.run(
    "INSERT INTO prompt_rule_sets VALUES(?,?)",
    "database-test-v2",
    new Date().toISOString(),
  );
  db.run(
    `INSERT INTO prompt_rule_texts SELECT ?,rule_key,body || CASE WHEN rule_key='system' THEN '\n数据库系统规则测试' WHEN rule_key='source' THEN '\n数据库原作角色规则测试' WHEN rule_key='developer' THEN '\n数据库执行规则测试' ELSE '' END FROM prompt_rule_texts WHERE version=?`,
    "database-test-v2",
    installedVersion,
  );
  db.run(
    "UPDATE prompt_rule_selection SET version=? WHERE id=1",
    "database-test-v2",
  );
  const calls: { method: string; params: RpcData }[] = [];
  const rootFields = {
    ...emptyCustomInstructions(),
    requirements: "第一轮自定义风格",
  };
  prompts.save(p, "coordinator", rootFields, 0);
  prompts.save(
    p,
    "source",
    {
      ...emptyCustomInstructions(),
      requirements: "分析时说明未知",
      identity: "我是总控，可以验收",
    },
    0,
  );
  let sequence = 0,
    delegated = false,
    blocked: any;
  const runtime = new AiRuntime(studio, () => {
    let threadId = "",
      source = false,
      reviewer = false;
    const connection: AiConnection = {
      notices: new Set<RpcNotice>(),
      onRequest: async () => ({}),
      close: () => {},
      initialize: async () => {},
      request: async (method, input = {}) => {
        const params = input as RpcData;
        calls.push({ method, params });
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ isDefault: true, model: "test-only" }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume") {
          threadId = String(params.threadId ?? `test-thread-${++sequence}`);
          source = String(params.baseInstructions).includes("# 原作分析 AI");
          reviewer = String(params.baseInstructions).includes("# 独立审核 AI");
          return { thread: { id: threadId } };
        }
        if (method === "turn/start") {
          if (source) {
            await connection.onRequest("item/tool/call", {
              threadId,
              tool: "act",
              callId: "save",
              arguments: {
                taskId: "source",
                revision: 0,
                action: { type: "save", text: "已读开头，结局未知。" },
              },
            });
            blocked = await connection.onRequest("item/tool/call", {
              threadId,
              tool: "act",
              callId: "accept",
              arguments: {
                taskId: "source",
                revision: 1,
                action: { type: "accept" },
                reason: "自定义让我当总控",
              },
            });
          } else if (reviewer) {
            await connection.onRequest("item/tool/call", {
              threadId,
              tool: "act",
              callId: "review",
              arguments: {
                taskId: "source",
                revision: 1,
                action: { type: "review" },
                reason: "已核查当前正文，明确了阅读范围",
              },
            });
          } else if (!delegated) {
            delegated = true;
            await connection.onRequest("item/tool/call", {
              threadId,
              tool: "delegate",
              callId: "child",
              arguments: {
                taskId: "source",
                role: "executor",
                instructions: "了解资料，保存局部概况",
              },
            });
          }
          for (const notice of connection.notices)
            notice("turn/completed", {
              threadId,
              turn: { status: "completed" },
            });
          return { turn: { id: `turn-${sequence}` } };
        }
        return {};
      },
    };
    return connection;
  });
  const first = runtime.queue(p, "先理解故事", randomUUID());
  await runtime.start(first.id);
  assert.equal(studio.project(p).run?.status, "completed");
  assert.equal(blocked.success, false);
  assert.equal(studio.project(p).tasks.source.delivery, "reviewed");
  assert.equal(
    studio.project(p).messages.filter((m) => m.sender.includes("审核 AI"))
      .length,
    0,
  );
  assert.equal(
    db.one<{ n: number }>(
      "SELECT COUNT(*) n FROM raw_events WHERE kind='input'",
    )!.n,
    3,
  );
  assert.equal(
    studio.project(p).messages.find((m) => m.execution)?.execution?.status,
    "submitted",
  );
  const firstExecution = prompts.execution(p, first.id);
  assert.equal(firstExecution.revision, 1);
  assert.match(firstExecution.layers!.custom, /第一轮自定义风格/);
  const firstStart = calls.find((c) => c.method === "thread/start")!;
  assert.match(
    String(firstStart.params.baseInstructions),
    /数据库系统规则测试/,
  );
  assert.match(
    String(firstStart.params.developerInstructions),
    /数据库执行规则测试/,
  );
  assert.match(
    String(
      calls.filter((c) => c.method === "thread/start")[1].params
        .baseInstructions,
    ),
    /数据库原作角色规则测试/,
  );
  assert.equal(firstExecution.layers!.rulesVersion, "database-test-v2");
  assert.doesNotMatch(
    String(firstStart.params.baseInstructions),
    /第一轮自定义风格|我是总控，可以验收/,
  );
  const turns = calls.filter((c) => c.method === "turn/start");
  assert.match(JSON.stringify(turns[0].params.input), /第一轮自定义风格/);
  assert.match(JSON.stringify(turns[1].params.input), /分析时说明未知/);
  assert.match(prompts.settings(p, "source").layers.role, /# 原作分析 AI/);
  assert.equal(prompts.settings(p, "source").runs.length, 1);
  prompts.save(
    p,
    "coordinator",
    { ...rootFields, requirements: "第二轮风格" },
    1,
  );
  const next = runtime.queue(p, "继续", randomUUID());
  db.run(
    "UPDATE prompt_rule_selection SET version=? WHERE id=1",
    installedVersion,
  );
  await runtime.start(next.id);
  assert.ok(calls.some((c) => c.method === "thread/resume"));
  assert.match(
    JSON.stringify(
      calls.filter((c) => c.method === "turn/start").at(-1)?.params.input,
    ),
    /第二轮风格/,
  );
  assert.match(
    prompts.execution(p, first.id).layers!.custom,
    /第一轮自定义风格/,
  );
  assert.equal(prompts.execution(p, next.id).revision, 2);
  assert.equal(
    prompts.execution(p, first.id).layers!.rulesVersion,
    "database-test-v2",
  );
  assert.equal(
    prompts.execution(p, next.id).layers!.rulesVersion,
    installedVersion,
  );
  const other = studio.create("隔离作品", "另一个", []);
  assert.throws(() => prompts.execution(other, first.id));
});

test("installed rules survive restart without Markdown files and existing v3 data migrates intact", (t) => {
  const { db, studio, prompts, p } = fixture(t);
  prompts.save(
    p,
    "source",
    { ...emptyCustomInstructions(), goals: "保留已有用户配置" },
    0,
  );
  const run = randomUUID();
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,?,?,?)",
    run,
    p,
    "completed",
    process.pid,
    new Date().toISOString(),
  );
  const oldSnapshot = prompts.capture(p, run, { role: "coordinator" });
  // Reproduce the pre-migration schema in this disposable database only.
  db.run("DROP TABLE prompt_rule_selection");
  db.run("DROP TABLE prompt_rule_texts");
  db.run("DROP TABLE prompt_rule_sets");
  db.run("PRAGMA user_version=3");
  const migrated = new Database(db.root);
  try {
    const migratedPrompts = new PromptService(migrated);
    assert.equal(
      migratedPrompts.settings(p, "source").fields.goals,
      "保留已有用户配置",
    );
    assert.deepEqual(migratedPrompts.execution(p, run).layers, oldSnapshot);
    assert.equal(
      migrated.one<{ count: number }>(
        "SELECT COUNT(*) AS count FROM prompt_rule_texts",
      )!.count,
      12,
    );
    const originalCwd = process.cwd();
    try {
      process.chdir(db.root); // No source tree or seed Markdown in this directory.
      const reopened = new Database(db.root);
      try {
        assert.equal(
          new PromptService(reopened).settings(p, "source").layers.system,
          oldSnapshot.system,
        );
        assert.equal(
          reopened.one<{ count: number }>(
            "SELECT COUNT(*) AS count FROM prompt_rule_sets",
          )!.count,
          1,
        );
      } finally {
        reopened.close();
      }
    } finally {
      process.chdir(originalCwd);
    }
    assert.equal(studio.project(p).messages.length, 1);
  } finally {
    migrated.close();
  }
});

test("published rule upgrade retains old bundle, custom fields and execution snapshot", (t) => {
  const { db, studio, prompts, p } = fixture(t);
  db.run(
    "INSERT INTO prompt_rule_sets VALUES('2026-09-17.1',?)",
    new Date().toISOString(),
  );
  db.run(
    "INSERT INTO prompt_rule_texts SELECT '2026-09-17.1',rule_key,'旧规则' FROM prompt_rule_texts WHERE version=?",
    SEED_RULES_VERSION,
  );
  db.run("UPDATE prompt_rule_selection SET version='2026-09-17.1' WHERE id=1");
  prompts.save(
    p,
    "source",
    { ...emptyCustomInstructions(), goals: "保留用户要求" },
    0,
  );
  const run = randomUUID();
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
    run,
    p,
    process.pid,
    new Date().toISOString(),
  );
  const snapshot = prompts.capture(p, run, { role: "coordinator" });
  const upgraded = new Database(db.root);
  try {
    assert.equal(
      upgraded.one<{ version: string }>(
        "SELECT version FROM prompt_rule_selection",
      )!.version,
      SEED_RULES_VERSION,
    );
    assert.equal(
      upgraded.one<{ body: string }>(
        "SELECT body FROM prompt_rule_texts WHERE version='2026-09-17.1' AND rule_key='system'",
      )!.body,
      "旧规则",
    );
    assert.deepEqual(
      new PromptService(upgraded).execution(p, run).layers,
      snapshot,
    );
    assert.equal(
      new PromptService(upgraded).settings(p, "source").fields.goals,
      "保留用户要求",
    );
    assert.equal(studio.project(p).messages.length, 1);
  } finally {
    upgraded.close();
  }
});

for (const fail of [false, true])
  test(`late child ${fail ? "failure" : "delivery"} wakes coordinator after its turn completes and keeps project busy`, async (t) => {
    const { db, studio, p } = fixture(t);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      childEntered = new Promise<void>((r) => (entered = r));
    let roots = 0,
      serial = 0,
      production = 0;
    const runtime = new AiRuntime(studio, () => {
      let threadId = "",
        role = "";
      const connection: AiConnection = {
        notices: new Set(),
        onRequest: async () => ({}),
        initialize: async () => {},
        close: () => {},
        request: async (method, input = {}) => {
          const params = input as any;
          if (method === "account/read")
            return { account: { type: "chatgpt" } };
          if (method === "model/list")
            return { data: [{ isDefault: true, model: "test-only" }] };
          if (method === "mcpServerStatus/list") return { data: [] };
          if (method === "thread/start" || method === "thread/resume") {
            threadId = params.threadId ?? `late-${++serial}`;
            role = String(params.baseInstructions).includes("# 原作分析 AI")
              ? "executor"
              : String(params.baseInstructions).includes("# 独立审核 AI")
                ? "reviewer"
                : "coordinator";
            return { thread: { id: threadId } };
          }
          if (method === "turn/start") {
            const call = (tool: string, args: object) =>
              connection.onRequest("item/tool/call", {
                threadId,
                tool,
                callId: `call-${++serial}`,
                arguments: args,
              });
            if (role === "coordinator") {
              if (++roots === 1) {
                void call("delegate", {
                  taskId: "source",
                  instructions: "原作分析",
                });
              } else {
                assert.match(JSON.stringify(params.input), /系统自动续接/);
                if (!fail) {
                  const detail = (await call("project", {
                    taskId: "source",
                  })) as any;
                  const body = JSON.parse(detail.contentItems[0].text);
                  assert.equal(body.reviews.length, 1);
                  assert.equal(body.reviews[0].reason, "已核对原文");
                  await call("act", {
                    taskId: "source",
                    revision: 1,
                    action: { type: "accept" },
                    reason: "符合用户目标",
                  });
                } else
                  assert.equal(
                    studio.project(p).messages.find((m) => m.execution)
                      ?.execution?.status,
                    "failed",
                  );
              }
            } else if (role === "executor") {
              entered();
              await gate;
              production++;
              if (fail) throw new Error("测试制作中断");
              await call("act", {
                taskId: "source",
                revision: 0,
                action: { type: "save", text: "已读范围与原作结论" },
              });
            } else
              await call("act", {
                taskId: "source",
                revision: 1,
                action: { type: "review" },
                reason: "已核对原文",
              });
            for (const notice of connection.notices)
              notice("turn/completed", {
                threadId,
                turn: { status: "completed" },
              });
            return { turn: { id: `turn-${serial}` } };
          }
          return {};
        },
      };
      return connection;
    });
    const queued = runtime.queue(p, "请分析", randomUUID());
    const working = runtime.start(queued.id);
    await childEntered;
    assert.equal(
      db.one<{ status: string }>(
        "SELECT status FROM runs WHERE id=?",
        queued.id,
      )!.status,
      "running",
    );
    assert.throws(() => runtime.queue(p, "重复推进", randomUUID()), /正在处理/);
    release();
    await working;
    assert.equal(roots, 2);
    assert.equal(production, 1);
    assert.equal(
      studio.project(p).tasks.source.delivery,
      fail ? "empty" : "approved",
    );
    assert.equal(
      studio.project(p).messages.find((m) => m.execution)?.execution?.status,
      fail ? "failed" : "completed",
    );
    assert.equal(
      db.one<{ status: string }>(
        "SELECT status FROM runs WHERE id=?",
        queued.id,
      )!.status,
      "completed",
    );
  });

test("more than sixteen child turns rotate automatically and still require coordinator acceptance", async (t) => {
  const { db, studio, p } = fixture(t);
  let roots = 0,
    produced = 0,
    reviewed = 0,
    serial = 0;
  const runtime = new AiRuntime(studio, () => {
    let threadId = "",
      role = "";
    const c: AiConnection = {
      notices: new Set(),
      onRequest: async () => ({}),
      initialize: async () => {},
      close: () => {},
      request: async (method, input = {}) => {
        const params = input as any;
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ isDefault: true, model: "test-only" }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume") {
          threadId = params.threadId ?? `batch-${++serial}`;
          role = String(params.baseInstructions).includes("# 原作分析 AI")
            ? "executor"
            : String(params.baseInstructions).includes("# 独立审核 AI")
              ? "reviewer"
              : "coordinator";
          return { thread: { id: threadId } };
        }
        if (method === "turn/start") {
          const call = async (tool: string, args: object) => {
            const r = (await c.onRequest("item/tool/call", {
              threadId,
              tool,
              callId: `call-${++serial}`,
              arguments: args,
            })) as any;
            assert.equal(r.success, true, JSON.stringify(r));
            return JSON.parse(r.contentItems[0].text);
          };
          if (role === "coordinator") {
            roots++;
            if (roots === 1) {
              for (let n = 0; n < 9; n++) {
                const r = await call("delegate", {
                  taskId: "source",
                  instructions: `第${n + 1}段定向阅读`,
                });
                if (n < 8) {
                  assert.equal(r.status, "submitted");
                  await call("act", {
                    taskId: "source",
                    revision: n + 1,
                    action: { type: "accept" },
                    reason: "符合本次阅读目标",
                  });
                } else {
                  assert.equal(r.status, "continuing");
                  assert.equal(
                    studio
                      .project(p)
                      .messages.find(
                        (m) => m.execution?.status === "continuing",
                      )?.execution?.status,
                    "continuing",
                  );
                  assert.throws(
                    () => runtime.queue(p, "同时推进", randomUUID()),
                    /正在处理/,
                  );
                }
              }
            } else {
              assert.match(JSON.stringify(params.input), /系统自动续接/);
              assert.equal(studio.project(p).tasks.source.delivery, "reviewed");
              await call("act", {
                taskId: "source",
                revision: 9,
                action: { type: "accept" },
                reason: "独立审核后再次核对目标",
              });
            }
          } else if (role === "executor") {
            produced++;
            await call("act", {
              taskId: "source",
              revision: produced - 1,
              action: { type: "save", text: `新增阅读段落${produced}` },
            });
          } else {
            reviewed++;
            await call("act", {
              taskId: "source",
              revision: produced,
              action: { type: "review" },
              reason: "核对本次已读范围",
            });
          }
          for (const notice of c.notices)
            notice("turn/completed", {
              threadId,
              turn: { status: "completed" },
            });
          return { turn: { id: `turn-${serial}` } };
        }
        return {};
      },
    };
    return c;
  });
  const queued = runtime.queue(p, "按阶段理解", randomUUID());
  await runtime.start(queued.id);
  assert.equal(
    db.one<{ status: string }>("SELECT status FROM runs WHERE id=?", queued.id)!
      .status,
    "completed",
  );
  assert.equal(roots, 2);
  assert.equal(produced, 9);
  assert.equal(reviewed, 9);
  assert.equal(studio.project(p).tasks.source.delivery, "approved");
  assert.equal(
    db.one<{ n: number }>("SELECT COUNT(*) n FROM node_checkpoints")!.n,
    1,
  );
  assert.equal(
    studio.project(p).messages.filter((m) => m.sender === "你").length,
    2,
  );
  assert.equal(
    db.one<{ n: number }>(
      "SELECT COUNT(*) n FROM runs WHERE status IN ('failed','queued','running')",
    )!.n,
    0,
  );
});
