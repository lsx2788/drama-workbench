import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import { importStory } from "../src/server/story-service";
import { startPreparation } from "../src/server/preparation-service";
import { saveOpenaiConfig } from "../src/server/openai-config";
import { queueAiTurn, executeAiTurn } from "../src/server/ai-runtime";
import {
  groupCandidates,
  groupEnvelope,
  setGroupMember,
  SILENT_REPLY,
} from "../src/server/group-service";
import { chatContext } from "../src/server/ai-context";
import { executeTool } from "../src/server/ai-tools";
import { updateAgentPrompt } from "../src/server/agent-prompt-service";
import type { AiResponse } from "../src/server/openai-provider";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-group-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProjectWithCoordinator(s, { name: "群聊测试" }).id);
  const ss = String(s.one("SELECT id FROM sessions")!.id);
  importStory(
    s,
    {
      source: "text",
      text: "青禾在渡口遇到云笙。",
      title: "短篇",
      importKey: randomUUID(),
    },
    p,
  );
  startPreparation(s, p, { coordinatorSessionId: ss });
  const reader = groupCandidates(s, p, ss).find(
    (r) => r.name === "原作初步分析 AI",
  )!;
  saveOpenaiConfig(s, {
    apiKey: "group-secret",
    model: "gpt-6-astra",
    imageModel: "gpt-image-2.5-sunburst",
  });
  return { s, p, ss, reader, child: String(reader.id), root };
}
const reply = (text: string): AiResponse => ({
  id: randomUUID(),
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  ],
});

test("unmentioned user input is delivered only to coordinator, never leaked to child inbox/history", async (t) => {
  const { s, p, ss, child } = fixture(t);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "只告诉总控的改编偏好",
  });
  let calls = 0;
  await executeAiTurn(s, p, String(turn.id), async () => {
    calls++;
    return reply("收到");
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    groupEnvelope(s, String(turn.message_id))!.recipients.map(
      (r) => r.session_id,
    ),
    [ss],
  );
  assert.equal(
    s.one("SELECT count(*) n FROM ai_calls WHERE session_id=?", child)!.n,
    0,
  );
  const history = await executeTool(
    s,
    p,
    child,
    "source-analysis",
    { action: "history", data: "{}" },
    async () => {},
  );
  assert.deepEqual(history.result, []);
  assert.throws(() => chatContext(s, p, child, String(turn.message_id)));
});

test("@ stores one human message, delivers to both with true identity and independent pinned prompts, coordinator can stay silent", async (t) => {
  const { s, p, ss, child, reader } = fixture(t);
  const input = {
    requestKey: randomUUID(),
    content: "@原作初步分析 AI 主角是谁？",
    mentionSessionIds: [child],
  };
  const turn = queueAiTurn(s, p, ss, input);
  assert.equal(queueAiTurn(s, p, ss, input).id, turn.id);
  const version = Number(
    s.one(
      "SELECT config_version FROM agents WHERE id=?",
      String(reader.agent_id),
    )!.config_version,
  );
  updateAgentPrompt(s, p, String(reader.agent_id), {
    expectedVersion: version,
    instructions: "下一轮才生效的规则",
  });
  let calls = 0;
  await executeAiTurn(s, p, String(turn.id), async (_key, body) => {
    calls++;
    const text = JSON.stringify(body);
    assert.ok(text.includes("真实发送者：用户本人"));
    if (calls === 1) {
      assert.ok(!text.includes("下一轮才生效的规则"));
      return reply("主角是青禾。");
    }
    assert.ok(text.includes("主角是青禾。"));
    assert.ok(text.includes("真实发送者：原作初步分析 AI"));
    return reply(SILENT_REPLY);
  });
  assert.equal(calls, 2);
  assert.equal(
    s.one("SELECT status FROM ai_turns WHERE id=?", String(turn.id))!.status,
    "completed",
  );
  assert.equal(
    s.one("SELECT count(*) n FROM messages WHERE sender_type='human'")!.n,
    1,
  );
  assert.equal(s.one("SELECT count(*) n FROM group_silences")!.n, 1);
  assert.equal(
    s.one("SELECT count(*) n FROM messages WHERE content=?", SILENT_REPLY)!.n,
    0,
  );
  assert.equal(
    s.one(
      "SELECT count(*) n FROM group_deliveries WHERE message_id=?",
      String(turn.message_id),
    )!.n,
    2,
  );
  const childReply = s.one(
    "SELECT * FROM messages WHERE sender_id=?",
    String(reader.agent_id),
  )!;
  assert.equal(
    groupEnvelope(s, String(childReply.id))!.reply_to_id,
    turn.message_id,
  );
  const history = await executeTool(
    s,
    p,
    child,
    "source-analysis",
    { action: "history", data: "{}" },
    async () => {},
  );
  assert.ok(JSON.stringify(history.result).includes('"sender_type":"human"'));
});

test("coordinator-to-child tool discussion is visible under coordinator identity, then child identity", async (t) => {
  const { s, p, ss, child, reader } = fixture(t);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "请分析故事",
  });
  let step = 0;
  await executeAiTurn(s, p, String(turn.id), async (_key, body) => {
    if (++step === 1)
      return {
        id: randomUUID(),
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "workbench",
            call_id: randomUUID(),
            arguments: JSON.stringify({
              action: "ask_child",
              data: JSON.stringify({
                sessionId: child,
                content: "请了解主角，按需读原文",
              }),
            }),
          },
        ],
      };
    if (step === 2) {
      assert.ok(JSON.stringify(body).includes("真实发送者：总控 AI"));
      return reply("我需要先确认阅读范围。");
    }
    return reply("我们先确认阅读范围。");
  });
  assert.equal(step, 3);
  const outbound = s.one(
    "SELECT * FROM messages WHERE content='请了解主角，按需读原文'",
  )!;
  assert.equal(outbound.sender_type, "agent");
  assert.notEqual(outbound.sender_id, reader.agent_id);
  assert.equal(groupEnvelope(s, String(outbound.id))!.group_id, ss);
  const childReply = s.one(
    "SELECT * FROM messages WHERE sender_id=?",
    String(reader.agent_id),
  )!;
  assert.equal(
    groupEnvelope(s, String(childReply.id))!.reply_to_id,
    outbound.id,
  );
});

test("members can leave and rejoin without losing native IDs or history; paused and foreign sessions cannot receive", async (t) => {
  const { s, p, ss, child } = fixture(t);
  s.run(
    "UPDATE sessions SET external_session_id='retained-codex-thread' WHERE id=?",
    child,
  );
  setGroupMember(s, p, ss, child, "paused");
  assert.throws(() =>
    queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      content: "您好",
      mentionSessionIds: [child],
    }),
  );
  assert.equal(s.one("SELECT count(*) n FROM messages")!.n, 0);
  assert.throws(() => setGroupMember(s, p, ss, ss, "paused"));
  const other = String(
    createProjectWithCoordinator(s, { name: "另一个项目" }).id,
  );
  const foreign = String(
    s.one(
      "SELECT ss.id FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?",
      other,
    )!.id,
  );
  assert.throws(() =>
    queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      content: "不跨项目",
      mentionSessionIds: [foreign],
    }),
  );
  setGroupMember(s, p, ss, child, "active");
  assert.equal(
    s.one("SELECT external_session_id FROM sessions WHERE id=?", child)!
      .external_session_id,
    "retained-codex-thread",
  );
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "继续",
    mentionSessionIds: [child],
  });
  assert.throws(() => setGroupMember(s, p, ss, child, "paused"));
  await executeAiTurn(s, p, String(turn.id), async () => reply("收到"));
  const count = s.one("SELECT count(*) n FROM messages")!.n;
  setGroupMember(s, p, ss, child, "paused");
  await assert.rejects(() =>
    executeTool(
      s,
      p,
      ss,
      "coordinator",
      {
        action: "ask_child",
        data: JSON.stringify({ sessionId: child, content: "不应收到" }),
      },
      async () => {
        assert.fail("must not run");
      },
      { id: ss, triggerId: String(turn.message_id) },
    ),
  );
  assert.equal(s.one("SELECT count(*) n FROM messages")!.n, count);
  const reopened = new Store(s.root);
  try {
    assert.equal(
      groupCandidates(reopened, p, ss).find((r) => r.id === child)!
        .membership_status,
      "paused",
    );
    assert.equal(reopened.one("SELECT count(*) n FROM messages")!.n, count);
  } finally {
    reopened.close();
  }
});

test("failed @ child is audited, coordinator receives failure notice, no automatic retry or false success", async (t) => {
  const { s, p, ss, child } = fixture(t);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "请看看",
    mentionSessionIds: [child],
  });
  let calls = 0;
  await executeAiTurn(s, p, String(turn.id), async (_key, body) => {
    if (++calls === 1) throw new Error("provider group-secret");
    assert.ok(JSON.stringify(body).includes("连接或模型执行失败"));
    return reply("原作分析本轮未完成，请稍后继续。");
  });
  assert.equal(calls, 2);
  assert.equal(
    s.one("SELECT status FROM ai_turns WHERE id=?", String(turn.id))!.status,
    "failed",
  );
  assert.equal(
    s.one("SELECT count(*) n FROM ai_tool_events WHERE name='group_delivery'")!
      .n,
    1,
  );
  assert.ok(
    !JSON.stringify(s.all("SELECT * FROM ai_tool_events")).includes(
      "group-secret",
    ),
  );
});
