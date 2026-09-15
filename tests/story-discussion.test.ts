import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/db";
import {
  importStory,
  storyDetail,
  storyFile,
} from "../src/server/story-service";
import { startStoryDiscussion } from "../src/server/story-discussion";
import { createAgent } from "../src/server/collaboration-service";
import { workspace } from "../src/server/read-service";

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-brief-"));
  const s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  return s;
}

test("preferences are stored separately and handed to a coordinator once without parsing the source", (t) => {
  const s = setup(t);
  const input = {
    source: "text",
    text: "原始故事独有正文，不应复制进聊天。",
    style: "other",
    customStyle: "黑白剪纸",
    ideas: "先做第一章。\n请保留原作结局。",
    importKey: randomUUID(),
  };
  const result = importStory(s, input),
    p = String(result.project.id),
    key = String(result.story.id);
  const before = workspace(s, p);
  assert.equal(before.messages.length, 0);
  assert.deepEqual(result.story.brief, {
    style: "other",
    customStyle: "黑白剪纸",
    ideas: input.ideas,
  });
  assert.deepEqual(storyFile(s, p, key).bytes, Buffer.from(input.text));
  const discussion = startStoryDiscussion(s, p, key);
  assert.equal(discussion.sessionId, before.sessions[0].id);
  assert.equal(discussion.execution, "not_configured");
  const after = workspace(s, p),
    message = after.messages[0];
  assert.equal(after.messages.length, 1);
  assert.equal(message.sender_type, "human");
  assert.match(String(message.content), /黑白剪纸/);
  assert.ok(String(message.content).includes(input.ideas));
  assert.equal(message.story_id, key);
  assert.equal(message.story_download_url, result.story.download_url);
  assert.ok(!String(message.content).includes(input.text));
  assert.equal(after.nodes.length, 1);
  assert.equal(after.runs.length, 0);
  assert.equal(after.highlights.length, 0);
  assert.deepEqual(startStoryDiscussion(s, p, key), discussion);
  assert.equal(importStory(s, input).story.id, key);
  assert.equal(workspace(s, p).messages.length, 1);
  assert.throws(
    () => importStory(s, { ...input, ideas: "改变想法" }),
    /内容已改变/,
  );
  const reopened = new Store(s.root);
  try {
    assert.deepEqual(storyDetail(reopened, p, key).brief, result.story.brief);
    assert.deepEqual(startStoryDiscussion(reopened, p, key), discussion);
  } finally {
    reopened.close();
  }
});

test("uncertain style remains a discussion; later imports keep prior discussions intact", (t) => {
  const s = setup(t);
  const first = importStory(s, {
    source: "text",
    text: "第一部分",
    importKey: randomUUID(),
  });
  const p = String(first.project.id);
  const one = startStoryDiscussion(s, p, String(first.story.id));
  const next = importStory(
    s,
    {
      source: "file",
      name: "第二部分.pdf",
      bytes: new Uint8Array([0xff, 0x00, 0x81]),
      style: "discuss",
      ideas: "尚未决定",
      importKey: randomUUID(),
    },
    p,
  );
  const two = startStoryDiscussion(s, p, String(next.story.id));
  assert.notEqual(one.sessionId, two.sessionId);
  assert.equal(workspace(s, p).messages.length, 2);
  assert.match(
    String(
      workspace(s, p).messages.find((m) => m.id === two.messageId)!.content,
    ),
    /让 AI 阅读后再一起讨论/,
  );
  assert.deepEqual(
    storyFile(s, p, String(next.story.id)).bytes,
    Buffer.from([0xff, 0x00, 0x81]),
  );
  assert.throws(
    () => startStoryDiscussion(s, randomUUID(), String(next.story.id)),
    /不存在/,
  );
});

test("failed discussion can be retried without losing the saved story or selecting an ambiguous coordinator", (t) => {
  const s = setup(t);
  const result = importStory(s, {
    source: "text",
    text: "保存成功",
    style: "anime_2d",
    importKey: randomUUID(),
  });
  const p = String(result.project.id),
    key = String(result.story.id),
    w = workspace(s, p);
  createAgent(s, p, {
    nodeId: w.nodes[0].id,
    name: "另一个协调 AI",
    purpose: "待确定",
  });
  assert.throws(() => startStoryDiscussion(s, p, key), /多个总控/);
  assert.deepEqual(storyFile(s, p, key).bytes, Buffer.from("保存成功"));
  assert.equal(workspace(s, p).messages.length, 0);
  s.db.exec(
    "CREATE TRIGGER fail_handoff BEFORE INSERT ON story_discussions BEGIN SELECT RAISE(ABORT, 'handoff failure'); END;",
  );
  assert.throws(
    () => startStoryDiscussion(s, p, key, { agentId: w.agents[0].id }),
    /handoff failure/,
  );
  assert.equal(workspace(s, p).messages.length, 0);
  assert.equal(workspace(s, p).sessions.length, 1);
  s.db.exec("DROP TRIGGER fail_handoff;");
  assert.ok(
    startStoryDiscussion(s, p, key, { agentId: w.agents[0].id }).messageId,
  );
  const count = s.all("SELECT * FROM story_sources").length;
  assert.throws(() =>
    importStory(s, {
      source: "text",
      text: "不能空填其他",
      style: "other",
      importKey: randomUUID(),
    }),
  );
  assert.throws(() =>
    importStory(s, {
      source: "text",
      text: "未知选项",
      style: "unknown",
      importKey: randomUUID(),
    }),
  );
  assert.equal(s.all("SELECT * FROM story_sources").length, count);
});
