import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { importStory } from "../src/server/story-service";
import { startPreparation } from "../src/server/preparation-service";
import {
  groupCandidates,
  setGroupMember,
  ensureGroup,
} from "../src/server/group-service";
import { executeTool } from "../src/server/ai-tools";
import { postHumanMessage } from "../src/server/collaboration-service";
import { publishGroupMessage } from "../src/server/group-service";
import { chatContext } from "../src/server/ai-context";
import { workspace } from "../src/server/read-service";
import { migrateDynamicCollaboration } from "../src/server/dynamic-collaboration-migration";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-dynamic-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const imported = importStory(s, {
    source: "text",
    text: "青禾在渡口救下云笙。",
    title: "青禾短篇",
    importKey: randomUUID(),
  });
  const p = String(imported.project.id),
    ss = String(workspace(s, p).sessions[0].id);
  ensureGroup(s, p, ss);
  const input = postHumanMessage(s, p, ss, {
    content: "先了解故事，之后再讨论改编。",
  }).message!;
  publishGroupMessage(s, p, ss, String(input.id), []);
  return {
    s,
    p,
    ss,
    story: imported.story,
    group: { id: ss, triggerId: String(input.id) },
  };
}

test("specialists are created separately, remain absent until invited, and resume the same sessions on demand", async (t) => {
  const { s, p, ss, group } = fixture(t);
  const reader = startPreparation(s, p, {
    coordinatorSessionId: ss,
    profile: "source-analysis",
  });
  assert.equal(reader.writing_node_id, null);
  assert.equal(s.one("SELECT count(*) n FROM agents")!.n, 2);
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === reader.sessionId)!
      .membership_status,
    "available",
  );
  const child = String(reader.sessionId);
  let executed = 0;
  const ask = () =>
    executeTool(
      s,
      p,
      ss,
      "coordinator",
      {
        action: "ask_child",
        data: JSON.stringify({
          sessionId: child,
          content: "请先了解故事基本信息。",
        }),
      },
      async (target) => {
        assert.equal(target, child);
        executed++;
        return { summary: "已了解" };
      },
      group,
    );
  await ask();
  assert.equal(
    groupCandidates(s, p, ss).filter((m) => m.membership_status === "active")
      .length,
    2,
  );
  setGroupMember(s, p, ss, child, "paused");
  s.run(
    "UPDATE sessions SET external_session_id='kept-thread' WHERE id=?",
    child,
  );
  assert.equal(
    startPreparation(s, p, { coordinatorSessionId: ss }).sessionId,
    child,
  );
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === child)!.membership_status,
    "paused",
  );
  const writer = startPreparation(s, p, {
    coordinatorSessionId: ss,
    profile: "screenwriting",
  });
  assert.ok(writer.writing_node_id);
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === writer.sessionId)!
      .membership_status,
    "available",
  );
  await ask();
  assert.equal(executed, 2);
  assert.equal(
    s.one("SELECT external_session_id FROM sessions WHERE id=?", child)!
      .external_session_id,
    "kept-thread",
  );
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === writer.sessionId)!
      .membership_status,
    "available",
  );
});

test("technical references are private context, visible tasks stay readable, bad references roll back activation and messages", async (t) => {
  const { s, p, ss, story, group } = fixture(t);
  const child = String(
    startPreparation(s, p, { coordinatorSessionId: ss }).sessionId,
  );
  let messageId = "";
  const content = "请按需阅读《青禾短篇》，说明故事概况和还不清楚的地方。";
  await executeTool(
    s,
    p,
    ss,
    "coordinator",
    {
      action: "ask_child",
      data: JSON.stringify({
        sessionId: child,
        content,
        sourceIds: [story.id],
      }),
    },
    async (_target, msg) => {
      messageId = msg;
      return {};
    },
    group,
  );
  const stored = s.one("SELECT content FROM messages WHERE id=?", messageId)!;
  assert.equal(stored.content, content);
  const context = JSON.stringify(chatContext(s, p, child, messageId));
  assert.ok(context.includes(String(story.id)));
  const visible = workspace(s, p).messages.find((m) => m.id === messageId)!;
  assert.equal(visible.display_content, content);
  assert.equal(visible.attachments[0].original_name, "青禾短篇.txt");
  const other = importStory(s, {
    source: "text",
    text: "另一个项目",
    importKey: randomUUID(),
  });
  setGroupMember(s, p, ss, child, "paused");
  const before = s.one("SELECT count(*) n FROM messages")!.n;
  await assert.rejects(() =>
    executeTool(
      s,
      p,
      ss,
      "coordinator",
      {
        action: "ask_child",
        data: JSON.stringify({
          sessionId: child,
          content,
          sourceIds: [other.story.id],
        }),
      },
      async () => assert.fail("must not run"),
      group,
    ),
  );
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === child)!.membership_status,
    "paused",
  );
  assert.equal(s.one("SELECT count(*) n FROM messages")!.n, before);
});

test("legacy technical text is projected readably without rewriting history or altering human text", async (t) => {
  const { s, p, ss, story, group } = fixture(t);
  const child = String(
    startPreparation(s, p, { coordinatorSessionId: ss }).sessionId,
  );
  const raw = `项目 ${p}；输入资料：storyId ${story.id}，sha256 ${story.sha256}。请用 read_document 阅读，保存 overview。hasMore=false`;
  let messageId = "";
  await executeTool(
    s,
    p,
    ss,
    "coordinator",
    {
      action: "ask_child",
      data: JSON.stringify({ sessionId: child, content: raw }),
    },
    async (_target, msg) => {
      messageId = msg;
      return {};
    },
    group,
  );
  const rendered = workspace(s, p).messages.find((m) => m.id === messageId)!;
  assert.equal(rendered.content, raw);
  assert.match(String(rendered.display_content), /青禾短篇/);
  assert.doesNotMatch(
    String(rendered.display_content),
    /storyId|sha256|read_document|overview|hasMore|，。|[0-9a-f]{8}-[0-9a-f]{4}/,
  );
  assert.match(String(rendered.display_content), /已到文末/);
  const human = postHumanMessage(s, p, ss, { content: raw }).message!;
  assert.equal(
    workspace(s, p).messages.find((m) => m.id === human.id)!.display_content,
    raw,
  );
});

test("migration retires unused automatically joined members, preserves active work, sessions and messages", (t) => {
  const { s, p, ss } = fixture(t);
  const reader = startPreparation(s, p, { coordinatorSessionId: ss });
  const writer = startPreparation(s, p, {
    coordinatorSessionId: ss,
    profile: "screenwriting",
  });
  setGroupMember(s, p, ss, String(reader.sessionId), "active");
  setGroupMember(s, p, ss, String(writer.sessionId), "active");
  s.run(
    "UPDATE sessions SET external_session_id='preserve-native' WHERE id=?",
    String(reader.sessionId),
  );
  const before = JSON.stringify(s.all("SELECT * FROM messages"));
  s.db.exec(
    "DROP TABLE message_context; DELETE FROM schema_migrations WHERE version=22",
  );
  migrateDynamicCollaboration(s);
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === reader.sessionId)!
      .membership_status,
    "active",
  );
  assert.equal(
    groupCandidates(s, p, ss).find((m) => m.id === writer.sessionId)!
      .membership_status,
    "available",
  );
  assert.equal(JSON.stringify(s.all("SELECT * FROM messages")), before);
  assert.equal(
    startPreparation(s, p, { coordinatorSessionId: ss }).sessionId,
    reader.sessionId,
  );
  assert.deepEqual(s.all("PRAGMA foreign_key_check"), []);
});
