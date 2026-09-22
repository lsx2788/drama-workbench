import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";

function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-plan-confirmation-"));
  const db = new Database(root),
    service = new StudioService(db),
    p = service.create("测试", "确认方向", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  for (const id of ["source", "brief"]) {
    service.act(
      p,
      id,
      { type: "save", text: "用户已明确的要求" },
      { role: "human" },
      0,
    );
    if (service.project(p).tasks[id].reviewEnabled)
      service.act(p, id, { type: "review" }, { role: "human" }, 1, "已核对");
    service.act(
      p,
      id,
      { type: "accept" },
      { role: "coordinator" },
      1,
      "已明确",
    );
  }
  return { db, service, p };
}

test("same plan reuses one confirmation; free-text plan acceptance resolves only its own reminder", (t) => {
  const { service, p } = fixture(t);
  const unrelated = service.message(
    p,
    "总控 AI",
    "coordinator",
    "需要另一种配色吗？",
    undefined,
    undefined,
    { audience: "human", requiresReply: true },
  );
  const first = service.propose(p, { summary: "本轮止于分镜" });
  const again = service.propose(p, { summary: "本轮止于分镜" });
  assert.equal(again.id, first.id);
  assert.equal(again.messageId, first.messageId);
  assert.equal(
    service
      .project(p)
      .messages.filter((m) => m.confirmation?.status === "pending").length,
    2,
  );
  const answer = service.message(
    p,
    "你",
    "human",
    "流程方案确认，其他问题稍后再说",
  );
  service.confirmPlan(p, first.id, answer);
  assert.equal(
    service.project(p).messages.find((m) => m.id === first.messageId)
      ?.confirmation?.answeredBy,
    answer,
  );
  assert.equal(
    service.project(p).messages.find((m) => m.id === unrelated)?.confirmation
      ?.status,
    "pending",
  );
  assert.equal(service.planConfirmation(p, first.id).status, "confirmed");
});

test("reusing a skipped proposal cannot reopen it, and responding does not itself approve the plan", (t) => {
  const { service, p } = fixture(t);
  const plan = service.propose(p, { summary: "待讨论的骨架" });
  service.skipConfirmation(p, plan.messageId);
  assert.equal(service.planConfirmation(p, plan.id).status, "skipped");
  assert.equal(
    service.propose(p, { summary: "待讨论的骨架" }).messageId,
    plan.messageId,
  );
  assert.equal(service.project(p).confirmed, false);
  assert.equal(
    service
      .project(p)
      .messages.filter((m) => m.confirmation?.status === "pending").length,
    0,
  );
  const replacement = service.propose(p, { summary: "按用户修改的新骨架" });
  assert.throws(() => service.planConfirmation(p, plan.id), /最新/);
  service.message(p, "你", "human", "暂时不同意，还要调整");
  assert.equal(service.planConfirmation(p, replacement.id).status, "answered");
  assert.equal(service.project(p).confirmed, false);
});

test("propose_plan followed by ask_user returns the original confirmation without duplicating the question", async (t) => {
  const { service, p } = fixture(t);
  let messageId = "",
    planId = "",
    passes = 0;
  const runtime = new AiRuntime(service, () => {
    const c: AiConnection = {
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
          return { thread: { id: "plan-test" } };
        if (method === "turn/start") {
          const call = async (tool: string, args: unknown) => {
            const response = (await c.onRequest("item/tool/call", {
              threadId: "plan-test",
              tool,
              callId: randomUUID(),
              arguments: args,
            })) as any;
            assert.equal(response.success, true);
            return JSON.parse(response.contentItems[0].text);
          };
          if (++passes === 1) {
            const proposed = await call("propose_plan", {
              summary: "本轮只做分镜，待用户确认",
            });
            messageId = proposed.messageId;
            planId = proposed.id;
          }
          const repeated = await call("ask_user", {
            text: "是否按此流程开始？",
            ...(passes > 1 ? { planId } : {}),
          });
          assert.equal(repeated.messageId, messageId);
          assert.equal(
            service.project(p).messages.filter((m) => m.confirmation).length,
            1,
          );
          for (const notice of c.notices)
            notice("turn/completed", {
              threadId: "plan-test",
              turn: { status: "completed" },
            });
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  await runtime.start(runtime.queue(p, "发布方案", randomUUID()).id);
  assert.ok(planId);
  await runtime.start(
    runtime.queue(p, "再看看方案，不是确认", randomUUID()).id,
  );
  assert.equal(passes, 2);
  assert.equal(service.project(p).confirmed, false);
  assert.equal(
    service.project(p).messages.filter((m) => m.confirmation).length,
    1,
  );
});
