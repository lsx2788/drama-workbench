import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { importStory } from "../src/server/story-service";
import { postHumanMessage } from "../src/server/collaboration-service";
import { publishGroupMessage } from "../src/server/group-service";
import { workspace } from "../src/server/read-service";
import { executeTool } from "../src/server/ai-tools";
import { workflowOutline } from "../src/server/workflow-outline-service";
import { mentionAt } from "../src/client/chat-mentions";
import {
  initialWorkflowOutline,
  withFixedOutlineStart,
} from "../src/shared/workflow-outline";

const plan = {
  title: "御剑短片制作路线",
  summary: "制作单条30秒竖屏视觉短片，不扩展故事。",
  steps: [
    {
      key: "direction",
      name: "确认方向",
      objective: "确认时长和视觉风格。",
      outputs: ["制作要求"],
      dependsOn: [],
    },
    {
      key: "visual",
      name: "视觉资产",
      objective: "准备人物与剑的定稿参考。",
      outputs: ["角色参考", "剑的参考"],
      dependsOn: ["direction"],
    },
    {
      key: "shots",
      name: "分镜设计",
      objective: "确定镜头顺序与节奏。",
      outputs: ["分镜表"],
      dependsOn: ["direction"],
    },
    {
      key: "video",
      name: "镜头制作",
      objective: "结合分镜和定稿资产生成视频。",
      outputs: ["候选镜头"],
      dependsOn: ["visual", "shots"],
    },
  ],
  questions: ["是否按30秒控制总时长？"],
};

test("fixed start is available before generation and legacy rendering is non-mutating and idempotent", () => {
  const start = initialWorkflowOutline();
  assert.deepEqual(
    start.steps.map((s) => s.name),
    ["总控", "原文分析", "编剧"],
  );
  const original = structuredClone(plan.steps);
  const projected = withFixedOutlineStart(plan.steps);
  assert.deepEqual(plan.steps, original);
  assert.deepEqual(withFixedOutlineStart(projected), projected);
  assert.deepEqual(projected[3].dependsOn, ["fixed_screenwriting"]);
  assert.deepEqual(projected[6].dependsOn, ["visual", "shots"]);
});

test("workflow outline tool persists clickable drafts and immutable revisions, without publishing or creating production nodes", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-outline-"));
  let s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const imported = importStory(s, {
    source: "text",
    title: "御剑飞行",
    text: "云澜御剑穿越峡谷。",
    importKey: randomUUID(),
  });
  const p = String(imported.project.id),
    ss = String(workspace(s, p).sessions[0].id);
  const msg = postHumanMessage(s, p, ss, {
    content: "先给我看看整体制作流程",
  }).message!;
  publishGroupMessage(s, p, ss, String(msg.id), []);
  const group = {
    id: ss,
    triggerId: String(msg.id),
    promptVersion: Number(
      s.one(
        "SELECT config_version FROM agents WHERE id=(SELECT agent_id FROM sessions WHERE id=?)",
        ss,
      )!.config_version,
    ),
  };
  const invoke = (data: unknown, profile = "coordinator") =>
    executeTool(
      s,
      p,
      ss,
      profile,
      { action: "propose_workflow_outline", data: JSON.stringify(data) },
      async () => assert.fail("must not execute child"),
      group,
    );
  const beforeNodes = s.one("SELECT count(*) n FROM nodes")!.n;
  const first = (await invoke(plan)).result as {
    id: string;
    messageId: string;
  };
  const w = workspace(s, p),
    m = w.messages.find((r) => r.id === first.messageId)!;
  assert.equal(w.workflowOutlines[0].message_id, m.id);
  assert.equal(m.sender_type, "agent");
  assert.equal((m.group as Record<string, unknown>).reply_to_id, msg.id);
  assert.equal(m.prompt_version, group.promptVersion);
  assert.equal(s.one("SELECT count(*) n FROM nodes")!.n, beforeNodes);
  assert.ok(w.workflows.every((r) => r.status === "draft"));
  const firstContent = workflowOutline(s, p, first.id).content;
  assert.deepEqual(
    firstContent.steps.slice(0, 3).map((step) => step.name),
    ["总控", "原文分析", "编剧"],
  );
  assert.deepEqual(firstContent.steps[3].dependsOn, ["fixed_screenwriting"]);
  const second = (
    await invoke({
      ...plan,
      previousId: first.id,
      title: "续写交付流程",
      steps: [
        {
          key: "delivery",
          name: "最终交付",
          objective: "保存审定成片",
          outputs: ["交付文件"],
          dependsOn: [],
        },
      ],
    })
  ).result as { id: string };
  assert.equal(workflowOutline(s, p, second.id).revision, 2);
  assert.deepEqual(
    workflowOutline(s, p, second.id).content.steps.slice(
      0,
      firstContent.steps.length,
    ),
    firstContent.steps,
  );
  assert.deepEqual(
    workflowOutline(s, p, second.id).content.steps.at(-1)!.dependsOn,
    ["video"],
  );
  assert.deepEqual(workflowOutline(s, p, first.id).content, firstContent);
  assert.equal(workflowOutline(s, p, first.id).content.title, plan.title);
  await assert.rejects(invoke({ ...plan, previousId: first.id }));
  await assert.rejects(invoke(plan, "source-analysis"));
  const count = s.one("SELECT count(*) n FROM messages")!.n;
  await assert.rejects(
    invoke({
      ...plan,
      previousId: second.id,
      steps: [
        { ...plan.steps[0], key: "a", dependsOn: ["b"] },
        { ...plan.steps[0], key: "b", dependsOn: ["a"] },
      ],
    }),
  );
  await assert.rejects(
    invoke({
      ...plan,
      previousId: second.id,
      steps: [{ ...plan.steps[0], key: "bad", dependsOn: ["missing"] }],
    }),
  );
  await assert.rejects(
    invoke({
      ...plan,
      previousId: second.id,
      steps: [{ ...plan.steps[0], key: "fixed_screenwriting" }],
    }),
    /固定节点|已有节点/,
  );
  await assert.rejects(
    invoke({
      ...plan,
      previousId: second.id,
      steps: [
        { ...plan.steps[0], key: "bypass", dependsOn: ["fixed_coordinator"] },
      ],
    }),
    /编剧之后/,
  );
  await assert.rejects(invoke(plan), /最新大纲/);
  assert.equal(s.one("SELECT count(*) n FROM messages")!.n, count);
  assert.throws(() =>
    s.run(
      "UPDATE workflow_outlines SET content_json='{}' WHERE id=?",
      first.id,
    ),
  );
  const other = importStory(s, {
    source: "text",
    text: "另一本故事",
    importKey: randomUUID(),
  });
  assert.throws(() => workflowOutline(s, String(other.project.id), first.id));
  s.close();
  s = new Store(root);
  assert.equal(workspace(s, p).workflowOutlines.length, 2);
  assert.deepEqual(s.all("PRAGMA foreign_key_check"), []);
});

test("typed mentions respect cursor position, fullwidth input, email boundaries and selected names", () => {
  assert.deepEqual(mentionAt("请@原作帮我看看", 4, []), {
    start: 1,
    end: 4,
    query: "原作",
  });
  assert.deepEqual(mentionAt("＠", 1, []), { start: 0, end: 1, query: "" });
  assert.equal(mentionAt("a@example.com", 13, []), null);
  assert.equal(mentionAt("@原作 AI 请看看", 10, ["原作 AI"]), null);
  assert.equal(mentionAt("没有提及", 4, []), null);
});
