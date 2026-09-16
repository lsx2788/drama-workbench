import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store, type Row } from "../src/server/db";
import { importStory } from "../src/server/story-service";
import { workspace } from "../src/server/read-service";
import {
  postHumanMessage,
  createSession,
} from "../src/server/collaboration-service";
import { publishGroupMessage } from "../src/server/group-service";
import { executeTool } from "../src/server/ai-tools";
import {
  askConfirmation,
  chatConfirmations,
  resolveConfirmation,
  skipConfirmation,
} from "../src/server/chat-confirmations";
import { startPreparation } from "../src/server/preparation-service";
import { promptSettings } from "../src/server/agent-prompt-service";
import { REPLY_CONFIRMATION_POLICY } from "../src/server/chat-confirmation-migration";
import { queueAiTurn, executeAiTurn } from "../src/server/ai-runtime";
import { saveOpenaiConfig } from "../src/server/openai-config";
import { SILENT_REPLY } from "../src/server/group-service";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-confirmations-"));
  const s = new Store(root);
  t.after(() => {
    if (s.db.isOpen) s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(
    importStory(s, {
      source: "text",
      text: "云澜御剑穿过峡谷。",
      importKey: randomUUID(),
    }).project.id,
  );
  const session = workspace(s, p).sessions[0],
    ss = String(session.id);
  const human = (content: string, quoteId?: string) => {
    const m = postHumanMessage(s, p, ss, {
      content,
      ...(quoteId ? { quoteId } : {}),
    }).message!;
    publishGroupMessage(s, p, ss, String(m.id), []);
    return String(m.id);
  };
  const trigger = human("先讨论基本方向，是不是需要确认一些事情？");
  return { root, s, p, ss, session, trigger, human };
}
const question = {
  key: "duration",
  title: "短片总时长",
  content: "建议将这段御剑内容控制在30秒，你希望保持这个时长，还是调整？",
};

test("runtime publishes the question through the model tool and later resolves it from an actual reply", async (t) => {
  const { s, p, ss } = fixture(t);
  saveOpenaiConfig(s, {
    apiKey: "test-only-key",
    model: "gpt-6-astra",
    imageModel: "gpt-image-2.5-sunburst",
  });
  const first = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "还有需要我确认的吗？",
  });
  const silent = () => ({
    id: randomUUID(),
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: SILENT_REPLY }],
      },
    ],
  });
  const action = (name: string, data: unknown) => ({
    id: randomUUID(),
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: randomUUID(),
        name: "workbench",
        arguments: JSON.stringify({ action: name, data: JSON.stringify(data) }),
      },
    ],
  });
  let calls = 0;
  await executeAiTurn(s, p, String(first.id), async (_secret, body) => {
    assert.ok(String(body.instructions).includes(REPLY_CONFIRMATION_POLICY));
    return ++calls === 1 ? action("ask_confirmation", question) : silent();
  });
  assert.equal(
    s.one("SELECT status FROM ai_turns WHERE id=?", String(first.id))!.status,
    "completed",
  );
  assert.equal(chatConfirmations(s, p).length, 1);
  const q = chatConfirmations(s, p)[0];
  assert.equal(
    workspace(s, p).messages.filter((m) => m.sender_type === "agent").length,
    1,
  );
  const second = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content: "做一分钟吧。",
    quoteId: q.message_id,
  });
  assert.equal(chatConfirmations(s, p)[0].status, "answered");
  calls = 0;
  await executeAiTurn(s, p, String(second.id), async () =>
    ++calls === 1
      ? action("resolve_confirmation", {
          id: q.id,
          userMessageId: second.message_id,
          reason: "用户明确选择一分钟",
        })
      : silent(),
  );
  assert.equal(
    s.one("SELECT status FROM ai_turns WHERE id=?", String(second.id))!.status,
    "completed",
  );
  assert.equal(chatConfirmations(s, p)[0].status, "answered");
  assert.equal(s.all("SELECT * FROM preparation_reviews").length, 0);
});

test("quoted human replies immediately clear reminders and survive restart without waiting for AI", async (t) => {
  const { root, s, p, ss, trigger, session, human } = fixture(t);
  assert.equal(chatConfirmations(s, p).length, 0);
  const prompt = promptSettings(s, p, String(session.agent_id)).current;
  assert.ok(
    prompt.layers!.system.instructions.includes(REPLY_CONFIRMATION_POLICY),
  );
  const call = () =>
    executeTool(
      s,
      p,
      ss,
      "coordinator",
      { action: "ask_confirmation", data: JSON.stringify(question) },
      async () => assert.fail("no model call"),
      { id: ss, triggerId: trigger, promptVersion: prompt.version },
    );
  const q = (await call()).result as Row;
  assert.deepEqual((await call()).result, q);
  const w = workspace(s, p),
    msg = w.messages.find((m) => m.id === q.message_id)!;
  assert.equal(msg.prompt_version, prompt.version);
  assert.equal(msg.content, question.content);
  assert.equal(msg.sender_id, session.agent_id);
  assert.equal(w.confirmations.length, 1);
  human("30秒是包含片头吗？", String(q.message_id));
  assert.equal(chatConfirmations(s, p)[0].status, "answered");
  assert.equal(s.all("SELECT * FROM preparation_reviews").length, 0);
  const reopened = new Store(root);
  try {
    assert.equal(chatConfirmations(reopened, p)[0].status, "answered");
    assert.deepEqual(reopened.all("PRAGMA foreign_key_check"), []);
  } finally {
    reopened.close();
  }
});

test("skip needs explicit confirmation, remains idempotent and never grants approval", (t) => {
  const { s, p, ss, trigger, human } = fixture(t);
  const q = askConfirmation(s, p, ss, question, trigger);
  assert.throws(() => skipConfirmation(s, p, String(q.id), {}));
  assert.throws(() => skipConfirmation(s, p, String(q.id), { confirm: false }));
  assert.equal(chatConfirmations(s, p)[0].status, "pending");
  const original = s.one(
    "SELECT * FROM messages WHERE id=?",
    String(q.message_id),
  );
  const skipped = skipConfirmation(s, p, String(q.id), { confirm: true });
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(
    skipConfirmation(s, p, String(q.id), { confirm: true }),
    skipped,
  );
  assert.deepEqual(
    s.one("SELECT * FROM messages WHERE id=?", String(q.message_id)),
    original,
  );
  assert.throws(
    () =>
      resolveConfirmation(s, p, ss, {
        id: q.id,
        userMessageId: human("先做其他的"),
        reason: "跳过视为同意",
      }),
    /跳过/,
  );
  assert.equal(s.all("SELECT * FROM preparation_reviews").length, 0);
  assert.equal(s.all("SELECT * FROM reviews").length, 0);
});

test("only same-group coordinator can resolve using a subsequent real human reply, without production approval", async (t) => {
  const { s, p, ss, trigger, human } = fixture(t);
  const q = askConfirmation(s, p, ss, question, trigger);
  startPreparation(s, p, { coordinatorSessionId: ss });
  const child = workspace(s, p).sessions.find((row) => row.id !== ss)!;
  const response = human("不要30秒，我希望做一分钟。");
  const data = { id: q.id, userMessageId: response, reason: "用户选择一分钟" };
  await assert.rejects(
    executeTool(
      s,
      p,
      String(child.id),
      "source-analysis",
      { action: "resolve_confirmation", data: JSON.stringify(data) },
      async () => {},
    ),
    /权限/,
  );
  assert.throws(
    () => resolveConfirmation(s, p, String(child.id), data),
    /总控/,
  );
  assert.throws(
    () => resolveConfirmation(s, p, ss, { ...data, userMessageId: trigger }),
    /真实用户回复/,
  );
  assert.throws(
    () =>
      resolveConfirmation(s, p, ss, { ...data, userMessageId: q.message_id }),
    /真实用户回复/,
  );
  const otherP = String(
    importStory(s, {
      source: "text",
      text: "另一个故事",
      importKey: randomUUID(),
    }).project.id,
  );
  const otherSs = String(workspace(s, otherP).sessions[0].id);
  assert.throws(
    () => skipConfirmation(s, otherP, String(q.id), { confirm: true }),
    /待确认/,
  );
  assert.throws(() => resolveConfirmation(s, p, otherSs, data));
  assert.equal(resolveConfirmation(s, p, ss, data).status, "answered");
  assert.equal(resolveConfirmation(s, p, ss, data).status, "answered");
  assert.throws(
    () => skipConfirmation(s, p, String(q.id), { confirm: true }),
    /状态已更新/,
  );
  assert.equal(s.all("SELECT * FROM preparation_reviews").length, 0);
  assert.equal(s.all("SELECT * FROM knowledge_reviews").length, 0);
});

test("failed question creation rolls back the message and duplicate keys cannot change a pending question", (t) => {
  const { s, p, ss, trigger } = fixture(t);
  const before = s.all("SELECT * FROM messages");
  assert.throws(() => askConfirmation(s, p, ss, question, randomUUID()));
  assert.deepEqual(s.all("SELECT * FROM messages"), before);
  askConfirmation(s, p, ss, question, trigger);
  assert.throws(
    () =>
      askConfirmation(
        s,
        p,
        ss,
        { ...question, content: "改成五分钟？" },
        trigger,
      ),
    /标识已使用/,
  );
  assert.equal(chatConfirmations(s, p).length, 1);
});

test("only the replied question in the same group is cleared; a later reply can answer a skipped question", (t) => {
  const { s, p, ss, trigger, human, session } = fixture(t);
  const first = askConfirmation(s, p, ss, question, trigger);
  const second = askConfirmation(
    s,
    p,
    ss,
    { ...question, key: "style", title: "风格" },
    trigger,
  );
  const other = createSession(s, p, {
    agentId: session.agent_id,
    title: "另一个讨论",
  });
  postHumanMessage(s, p, String(other.id), {
    content: "另一群的引用",
    quoteId: first.message_id,
  });
  human("普通聊天消息");
  assert.ok(chatConfirmations(s, p).every((q) => q.status === "pending"));
  skipConfirmation(s, p, String(first.id), { confirm: true });
  const reply = human("我现在补充一下", String(first.message_id));
  const rows = chatConfirmations(s, p);
  assert.equal(rows.find((q) => q.id === first.id)!.response_message_id, reply);
  assert.equal(rows.find((q) => q.id === first.id)!.status, "answered");
  assert.equal(rows.find((q) => q.id === second.id)!.status, "pending");
});

test("failed send rolls back the reply and its automatic confirmation together", (t) => {
  const { s, p, ss, trigger } = fixture(t);
  saveOpenaiConfig(s, {
    apiKey: "test-only-key",
    model: "gpt-6-astra",
    imageModel: "gpt-image-2.5-sunburst",
  });
  const q = askConfirmation(s, p, ss, question, trigger);
  const count = s.all("SELECT id FROM messages").length;
  s.db.exec(
    "CREATE TRIGGER fail_queue BEFORE INSERT ON ai_turns BEGIN SELECT RAISE(ABORT,'test queue failure'); END;",
  );
  assert.throws(
    () =>
      queueAiTurn(s, p, ss, {
        requestKey: randomUUID(),
        content: "一分钟",
        quoteId: q.message_id,
      }),
    /test queue failure/,
  );
  assert.equal(s.all("SELECT id FROM messages").length, count);
  assert.equal(chatConfirmations(s, p)[0].status, "pending");
  assert.equal(
    s.all(
      "SELECT * FROM audit_events WHERE action='chat.confirmation_answered'",
    ).length,
    0,
  );
});
