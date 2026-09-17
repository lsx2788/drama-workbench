import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import {
  saveOpenaiConfig,
  publicOpenaiConfig,
} from "../src/server/openai-config";
import {
  queueAiTurn,
  executeAiTurn,
  listAiTurns,
  turnDetail,
} from "../src/server/ai-runtime";
import { importStory, storyFile } from "../src/server/story-service";
import { workspace } from "../src/server/read-service";
import { updateAgentPrompt } from "../src/server/agent-prompt-service";
import { executeTool, toolActions } from "../src/server/ai-tools";
import { startPreparation } from "../src/server/preparation-service";
import {
  providerError,
  type AiResponse,
  type AiItem,
} from "../src/server/openai-provider";
import { chatContext, auditJson } from "../src/server/ai-context";
import { postHumanMessage } from "../src/server/collaboration-service";
import { createChildAgent } from "../src/server/child-authorization";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-ai-"));
  const s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProjectWithCoordinator(s, { name: "接入验收" }).id);
  const session = s.one("SELECT * FROM sessions LIMIT 1")!;
  saveOpenaiConfig(s, {
    apiKey: "test-secret-never-expose",
    model: "gpt-6-astra",
    imageModel: "gpt-image-2.5-sunburst",
  });
  return {
    s,
    p,
    ss: String(session.id),
    agent: String(session.agent_id),
    root,
  };
}
function reply(text = "收到，我们先确认改编范围。"): AiResponse {
  return {
    id: `resp_${randomUUID()}`,
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}
function call(action: string, data: unknown): AiResponse {
  return {
    id: `resp_${randomUUID()}`,
    status: "completed",
    output: [
      {
        type: "function_call",
        id: randomUUID(),
        name: "workbench",
        call_id: randomUUID(),
        arguments: JSON.stringify({ action, data: JSON.stringify(data) }),
      },
    ],
  };
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kE3sAAAAASUVORK5CYII=",
  "base64",
);

test("coordinator grants a child request then resumes it for authorized nested execution", async (t) => {
  const { s, p, ss } = fixture(t);
  const parent = String(
    createChildAgent(s, p, ss, ss, {
      key: "planner",
      spec: { name: "分镜 AI", objective: "设计镜头" },
    }).sessionId,
  );
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "请安排协作",
  });
  let step = 0;
  await executeAiTurn(s, p, String(turn.id), async () => {
    step++;
    const request = s.one(
      "SELECT * FROM child_authorizations ORDER BY rowid DESC LIMIT 1",
    );
    if (step === 1)
      return call("ask_child", {
        sessionId: parent,
        content: "请检查任务是否需要协助",
      });
    if (step === 2)
      return call("request_child_authorization", {
        key: "continuity",
        spec: { name: "连续性 AI", objective: "检查镜头衔接" },
        reason: "需要独立检查",
      });
    if (step === 3) return reply("已提交协作申请，等待总控授权。");
    if (step === 4)
      return call("review_child_authorization", {
        id: request!.id,
        decision: "approved",
        reason: "同意进行独立核对",
      });
    if (step === 5)
      return call("ask_child", {
        sessionId: parent,
        content: "申请已批准，请查询授权后继续。",
      });
    if (step === 6) return call("child_authorizations", {});
    if (step === 7)
      return call("create_child", {
        key: "continuity-child",
        authorizationCode: request!.authorization_code,
      });
    if (step === 8)
      return call("ask_child", {
        sessionId: request!.child_session_id,
        content: "请检查人物动作的衔接。",
        authorizationCode: request!.authorization_code,
      });
    if (step === 9) return reply("核对完成，第二镜需要补充人物朝向说明。");
    if (step === 10) return reply("已收到连续性检查结果，请总控审核。");
    return reply("协作已完成，结果等待审核。");
  });
  assert.equal(step, 11);
  assert.equal(listAiTurns(s, p, ss)[0].status, "completed");
  const grant = s.one("SELECT * FROM child_authorizations")!;
  assert.equal(grant.used_calls, 1);
  assert.ok(grant.child_session_id);
  assert.ok(
    !JSON.stringify(turnDetail(s, p, String(turn.id))).includes(
      String(grant.authorization_code),
    ),
  );
  const messages = workspace(s, p).messages;
  assert.ok(
    messages.some(
      (m) =>
        m.sender_name === "连续性 AI" && String(m.content).includes("第二镜"),
    ),
  );
  assert.ok(messages.some((m) => String(m.content).includes("已批准协作授权")));
});

test("AI config never returns keys and preserves them when editing models", (t) => {
  const { s, root } = fixture(t);
  saveOpenaiConfig(s, {
    model: "gpt-5.5",
    imageModel: "gpt-image-2.5-sunburst",
  });
  assert.equal(publicOpenaiConfig(s).configured, true);
  assert.ok(!JSON.stringify(publicOpenaiConfig(s)).includes("test-secret"));
  assert.ok(
    readFileSync(path.join(root, "openai.local.json"), "utf8").includes(
      "test-secret",
    ),
  );
  assert.throws(() =>
    saveOpenaiConfig(s, { model: "../secret", imageModel: "invalid" }),
  );
});
test("enqueue is idempotent, locks sessions, pins prompts, persists actual calls and replies", async (t) => {
  const { s, p, ss, agent } = fixture(t);
  const input = { requestKey: randomUUID(), content: "我想制作三集" };
  const turn = queueAiTurn(s, p, ss, input);
  assert.equal(queueAiTurn(s, p, ss, input).id, turn.id);
  assert.throws(() => queueAiTurn(s, p, ss, { ...input, content: "变更内容" }));
  assert.throws(() =>
    queueAiTurn(s, p, ss, { requestKey: randomUUID(), content: "第二条" }),
  );
  const version = Number(
    s.one("SELECT config_version FROM agents WHERE id=?", agent)
      ?.config_version,
  );
  updateAgentPrompt(s, p, agent, {
    expectedVersion: version,
    instructions: "仅用于下一轮的新指令",
  });
  let count = 0;
  await executeAiTurn(s, p, String(turn.id), async (_key, body) => {
    count++;
    assert.ok(!JSON.stringify(body).includes("仅用于下一轮的新指令"));
    return reply();
  });
  await executeAiTurn(s, p, String(turn.id), async () => {
    throw new Error("must not repeat");
  });
  assert.equal(count, 1);
  assert.equal(listAiTurns(s, p, ss)[0].status, "completed");
  assert.equal(workspace(s, p).messages.length, 2);
  const detail = turnDetail(s, p, String(turn.id));
  assert.equal(detail.calls.length, 1);
  assert.ok(!JSON.stringify(detail).includes("test-secret"));
  assert.ok(
    s.one("SELECT external_session_id FROM sessions WHERE id=?", ss)
      ?.external_session_id,
  );
});
test("attachments keep bytes, do not inline novels, and send actual image inputs on demand", async (t) => {
  const { s, p, ss } = fixture(t);
  const novel = "PRIVATE-NOVEL-CONTENT".repeat(10000);
  const text = importStory(
    s,
    { source: "text", text: novel, title: "长篇", importKey: randomUUID() },
    p,
  ).story;
  const photo = importStory(
    s,
    {
      source: "file",
      name: "reference.png",
      bytes: png,
      importKey: randomUUID(),
    },
    p,
  ).story;
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    storyIds: [text.id, photo.id],
  });
  let step = 0;
  await executeAiTurn(s, p, String(turn.id), async (_key, body) => {
    if (!step++) {
      assert.ok(!JSON.stringify(body).includes("PRIVATE-NOVEL-CONTENT"));
      return call("view_source", { storyId: photo.id });
    }
    assert.ok(JSON.stringify(body).includes("data:image/png;base64,"));
    return reply("看到了参考图片。");
  });
  assert.equal(listAiTurns(s, p, ss)[0].status, "completed");
  assert.equal(workspace(s, p).messages[0].attachments.length, 2);
  assert.ok(storyFile(s, p, String(photo.id)).bytes.equals(png));
  const audit = JSON.stringify(turnDetail(s, p, String(turn.id)));
  assert.ok(audit.includes("mediaSha256"));
  assert.ok(!audit.includes(png.toString("base64")));
});
test("generation produces persisted candidate assets and reloadable chat images", async (t) => {
  const { s, p, ss, root } = fixture(t);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "生成一张古代渡口图片",
  });
  await executeAiTurn(s, p, String(turn.id), async () => ({
    id: "resp_image",
    status: "completed",
    output: [
      {
        type: "image_generation_call",
        id: "ig_1",
        result: png.toString("base64"),
        revised_prompt: "古代渡口",
      },
    ],
  }));
  const w = workspace(s, p);
  assert.equal(listAiTurns(s, p, ss)[0].status, "completed");
  assert.equal(w.assets.length, 1);
  assert.equal(s.one("SELECT status FROM asset_versions")?.status, "candidate");
  const pictures = w.messages[1].images as AiItem[];
  assert.equal(pictures.length, 1);
  assert.ok(String(pictures[0].url).startsWith(`/api/v1/projects/${p}/files/`));
  assert.equal(readdirSync(path.join(root, "files")).length, 1);
  assert.ok(
    !JSON.stringify(turnDetail(s, p, String(turn.id))).includes(
      png.toString("base64"),
    ),
  );
});
test("failure does not lose input or retry paid calls, and a new message can continue", async (t) => {
  const { s, p, ss } = fixture(t);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "继续",
  });
  let calls = 0;
  await executeAiTurn(s, p, String(turn.id), async () => {
    calls++;
    throw new Error("upstream echoed secret test-secret-never-expose");
  });
  assert.equal(calls, 1);
  assert.equal(listAiTurns(s, p, ss)[0].status, "failed");
  assert.ok(!JSON.stringify(listAiTurns(s, p, ss)).includes("test-secret"));
  assert.equal(workspace(s, p).messages.length, 1);
  assert.doesNotThrow(() =>
    queueAiTurn(s, p, ss, { requestKey: randomUUID(), content: "再继续一次" }),
  );
});
test("stale queued work is marked interrupted and never silently dispatched", (t) => {
  const { s, p, ss } = fixture(t);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "处理",
  });
  s.run(
    "UPDATE ai_turns SET owner='previous-process' WHERE id=?",
    String(turn.id),
  );
  assert.equal(listAiTurns(s, p, ss)[0].status, "interrupted");
});
test("tool boundary rejects cross-project files, child-to-parent execution and unavailable capabilities", async (t) => {
  const { s, p, ss } = fixture(t);
  const other = String(
    createProjectWithCoordinator(s, { name: "另一个项目" }).id,
  );
  const file = importStory(
    s,
    {
      source: "file",
      name: "private.png",
      bytes: png,
      importKey: randomUUID(),
    },
    other,
  ).story;
  const execute = (action: string, data: unknown) =>
    executeTool(
      s,
      p,
      ss,
      "coordinator",
      { action, data: JSON.stringify(data) },
      async () => null,
    );
  await assert.rejects(execute("view_source", { storyId: file.id }));
  await assert.rejects(
    execute("read_source_range", {
      storyId: file.id,
      startByte: 0,
      endByte: 10,
      encoding: "utf-8",
    }),
  );
  await assert.rejects(
    execute("ask_child", { sessionId: ss, content: "自调用" }),
  );
  assert.ok(!toolActions("source-analysis").includes("review_record"));
  assert.ok(toolActions("source-analysis").includes("ask_child"));
  assert.ok(
    !toolActions("source-analysis").includes("review_child_authorization"),
  );
  assert.throws(() =>
    queueAiTurn(s, other, ss, { requestKey: randomUUID(), content: "越权" }),
  );
});
test("coordinator delegates to an actual child, with independent histories and saved tool receipts", async (t) => {
  const { s, p, ss } = fixture(t);
  importStory(
    s,
    {
      source: "text",
      text: "少年在渡口发现账本。",
      title: "故事",
      importKey: randomUUID(),
    },
    p,
  );
  const setup = startPreparation(s, p, { coordinatorSessionId: ss });
  const child = String(
    s.one(
      "SELECT ss.id FROM sessions ss JOIN agents a ON a.id=ss.agent_id WHERE a.node_id=?",
      String(setup.analysis_node_id),
    )?.id,
  );
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "先了解故事",
  });
  let step = 0;
  await executeAiTurn(s, p, String(turn.id), async () => {
    step++;
    if (step === 1)
      return call("ask_child", {
        sessionId: child,
        content: "请按需理解故事并汇报初步概况",
      });
    if (step === 2) return reply("初步可见少年与账本线索，还未通读。");
    return reply("分析 AI 已返回初步概况。你计划做几集？");
  });
  assert.equal(step, 3);
  assert.equal(listAiTurns(s, p, ss)[0].status, "completed");
  assert.equal(
    s.all("SELECT * FROM messages WHERE session_id=?", child).length,
    2,
  );
  assert.equal(turnDetail(s, p, String(turn.id)).calls.length, 3);
  assert.equal(turnDetail(s, p, String(turn.id)).tools.length, 1);
});
test("existing stored handoff can run once, and malformed generated images roll back their asset", async (t) => {
  const { s, p, ss, root } = fixture(t);
  const posted = postHumanMessage(s, p, ss, { content: "开始了解故事" });
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    messageId: posted.message!.id,
  });
  await executeAiTurn(s, p, String(turn.id), async () => ({
    id: "bad",
    status: "completed",
    output: [
      {
        type: "image_generation_call",
        id: "bad-image",
        result: Buffer.from("not-image").toString("base64"),
      },
    ],
  }));
  assert.equal(listAiTurns(s, p, ss)[0].status, "failed");
  assert.equal(workspace(s, p).messages.length, 1);
  assert.equal(workspace(s, p).assets.length, 0);
  assert.equal(readdirSync(path.join(root, "files")).length, 0);
  assert.throws(() =>
    queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      messageId: posted.message!.id,
    }),
  );
});
test("history context is bounded and explicitly identifies missing older history", (t) => {
  const { s, p, ss } = fixture(t);
  for (let i = 0; i < 45; i++)
    postHumanMessage(s, p, ss, { content: `message-${i}` });
  const context = chatContext(s, p, ss);
  assert.equal(context.length, 41);
  assert.ok(JSON.stringify(context[0]).includes("更早内容未自动载入"));
  assert.ok(!JSON.stringify(context).includes("message-0"));
  assert.ok(
    !auditJson({
      image_url: `data:image/png;base64,${png.toString("base64")}`,
    }).includes(png.toString("base64")),
  );
  assert.match(providerError(401).message, /密钥/);
});
