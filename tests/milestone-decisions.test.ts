import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import { decisionMilestones } from "../src/server/ai/milestone-decisions";

function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-milestone-"));
  const db = new Database(root),
    service = new StudioService(db),
    p = service.create("收尾检查", "只做文字", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  db.run(
    "INSERT INTO tasks VALUES(?,?,'storyboard','全片分镜','分镜',1,NULL,1,1)",
    p,
    "episode-1-storyboard",
  );
  db.run("INSERT INTO episodes VALUES(?,1,'第一集','测试',0)", p);
  db.run("UPDATE projects SET confirmed=1 WHERE id=?", p);
  const accept = () => {
    service.act(
      p,
      "episode-1-storyboard",
      {
        type: "save",
        text: "已完成的全片分镜",
        structure: {
          kind: "shots",
          complete: true,
          representative: 1,
          reason: "代表",
          items: [
            {
              number: 1,
              title: "第一镜",
              text: "已完成的全片分镜",
              synopsis: "测试",
            },
          ],
        },
      },
      { role: "human" },
      0,
    );
    service.act(
      p,
      "episode-1-storyboard",
      { type: "review" },
      { role: "human" },
      1,
      "测试审核",
    );
    service.act(
      p,
      "episode-1-storyboard",
      { type: "accept" },
      { role: "coordinator" },
      1,
      "测试验收",
    );
  };
  return { db, service, p, accept };
}

function mockRuntime(
  service: StudioService,
  act: (
    turn: number,
    call: (name: string, args: unknown) => Promise<any>,
  ) => Promise<void>,
) {
  let turns = 0;
  const runtime = new AiRuntime(service, () => {
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
          return { thread: { id: "milestone-test" } };
        if (method === "turn/start") {
          const call = async (tool: string, args: unknown) =>
            c.onRequest("item/tool/call", {
              threadId: "milestone-test",
              tool,
              callId: randomUUID(),
              arguments: args,
            });
          await act(++turns, call);
          for (const notice of c.notices) {
            notice("item/completed", {
              threadId: "milestone-test",
              item: {
                id: randomUUID(),
                type: "agentMessage",
                phase: "final_answer",
                text: "全片分镜已完成。",
              },
            });
            notice("turn/completed", {
              threadId: "milestone-test",
              turn: { status: "completed" },
            });
          }
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  return { runtime, turns: () => turns };
}

test("silent milestone completion gets one bounded read/ask-only coordinator handoff", async (t) => {
  const { db, service, p, accept } = fixture(t);
  const { runtime, turns } = mockRuntime(service, async (turn, call) => {
    if (turn === 1) {
      accept();
      return;
    }
    assert.equal(turn, 2);
    const forbidden = await call("delegate", {
      taskId: "episode-1-storyboard",
      instructions: "不允许自动扩展",
    });
    assert.equal(forbidden.success, false);
    const question = {
      text: "全片文字已完成，按已确认的文字范围停下。保留交付、修改，还是另行确认资产制作？",
    };
    const first = await call("ask_user", question),
      second = await call("ask_user", question);
    assert.equal(first.success, true);
    assert.deepEqual(first.contentItems, second.contentItems);
  });
  const run = runtime.queue(p, "继续文字", randomUUID());
  await runtime.start(run.id);
  assert.equal(turns(), 2);
  assert.equal(
    db.one<any>("SELECT status FROM runs WHERE id=?", run.id)?.status,
    "completed",
  );
  const messages = service.project(p).messages;
  assert.equal(
    messages.filter((m) => m.confirmation?.status === "pending").length,
    1,
  );
  assert.equal(messages.filter((m) => m.text === "全片分镜已完成。").length, 1);
  assert.equal(db.all("SELECT id FROM node_jobs").length, 0);
});

for (const disposition of ["pending", "answered", "skipped"] as const) {
  test(`an existing ${disposition} question is not repeated at the milestone`, async (t) => {
    const { service, p, accept } = fixture(t);
    const { runtime, turns } = mockRuntime(service, async (_, call) => {
      accept();
      const result = await call("ask_user", {
        text: "文字已完成，下一步如何处理？",
      });
      const id = JSON.parse(result.contentItems[0].text).messageId;
      if (disposition === "skipped") service.skipConfirmation(p, id);
      if (disposition === "answered")
        service.message(p, "你", "human", "暂时不用继续");
    });
    await runtime.start(runtime.queue(p, "完成文字", randomUUID()).id);
    assert.equal(turns(), 1);
    assert.equal(
      service.project(p).messages.filter((m) => m.confirmation).length,
      1,
    );
    assert.equal(
      service.project(p).messages.find((m) => m.confirmation)?.confirmation
        ?.status,
      disposition,
    );
  });
}

test("ordinary progress and old milestones do not add confirmation gates", async (t) => {
  const { service, p, accept } = fixture(t);
  accept();
  const { runtime, turns } = mockRuntime(service, async () => {});
  await runtime.start(runtime.queue(p, "查看进度", randomUUID()).id);
  assert.equal(turns(), 1);
  assert.equal(
    service.project(p).messages.filter((m) => m.confirmation).length,
    0,
  );
  const project = service.project(p),
    base = project.tasks["episode-1-storyboard"];
  project.tasks["board"] = { ...base, id: "board", kind: "board", shot: 1 };
  project.tasks["supplement"] = {
    ...base,
    id: "supplement",
    kind: "assets",
    imageSpec: { purpose: "面部特写" },
  };
  assert.deepEqual(
    decisionMilestones(project).map((t) => t.id),
    [base.id],
  );
});

test("manual repair is system-authored, idempotent, and reply/skip does not start production", async (t) => {
  const { db, service, p, accept } = fixture(t);
  accept();
  const { runtime, turns } = mockRuntime(service, async (_, call) => {
    await call("ask_user", {
      text: "已达文字交付边界。是否需要调整或另行确认后续范围？",
    });
  });
  await runtime.requestMilestoneDecision(p);
  const question = service.project(p).messages.find((m) => m.confirmation)!;
  service.skipConfirmation(p, question.id);
  await runtime.requestMilestoneDecision(p);
  assert.equal(turns(), 1);
  assert.equal(db.all("SELECT id FROM node_jobs").length, 0);
  assert.equal(
    db.one<any>(
      "SELECT role FROM messages WHERE request_id LIKE 'milestone-decision:%'",
    )?.role,
    "system",
  );
});
