import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/db";
import { importStory, storyDetail } from "../src/server/story-service";
import { startStoryDiscussion } from "../src/server/story-discussion";
import { listStoryPreferences } from "../src/server/story-preference-catalog";

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-message-preferences-"));
  const s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const result = importStory(s, {
    source: "text",
    text: "原文",
    importKey: randomUUID(),
  });
  return { s, p: String(result.project.id), key: String(result.story.id) };
}

test("selected choices only become message text; no independent preference storage", (t) => {
  const { s, p, key } = setup(t);
  const input = {
    preferences: [
      { category: "scope", option: "selected", detail: "第一章到第三章" },
      { category: "adaptation", option: "faithful", detail: "" },
      { category: "duration", option: "other", detail: "每集大约 8 分钟" },
    ],
    ideas: "保留结局",
  };
  const discussion = startStoryDiscussion(s, p, key, input);
  const content = String(
    s.one("SELECT content FROM messages WHERE id=?", discussion.messageId)
      ?.content,
  );
  assert.match(content, /第一章到第三章/);
  assert.match(content, /尽量忠实原文/);
  assert.match(content, /每集大约 8 分钟/);
  assert.match(content, /保留结局/);
  assert.doesNotMatch(content, /画面风格|发布平台|画幅/);
  assert.equal(storyDetail(s, p, key).brief, undefined);
  for (const table of [
    "story_briefs",
    "story_intake_briefs",
    "documents",
    "highlights",
  ])
    assert.equal(s.all(`SELECT * FROM ${table}`).length, 0);
  assert.deepEqual(
    startStoryDiscussion(s, p, key, { ideas: "另一种想法" }),
    discussion,
  );
  assert.equal(
    s.one("SELECT content FROM messages WHERE id=?", discussion.messageId)
      ?.content,
    content,
  );
});

test("invalid message choices fail atomically, while the imported story stays saved", (t) => {
  const { s, p, key } = setup(t);
  const choice = { category: "scope", option: "selected", detail: "第一章" };
  for (const invalid of [
    [{ category: "unknown", option: "discuss", detail: "" }],
    [{ category: "scope", option: "portrait", detail: "" }],
    [{ category: "scope", option: "selected", detail: "  " }],
    [{ category: "aspect", option: "portrait", detail: "隐藏的旧自定义内容" }],
    [choice, choice],
  ])
    assert.throws(() =>
      startStoryDiscussion(s, p, key, { preferences: invalid }),
    );
  assert.equal(s.all("SELECT * FROM messages").length, 0);
  assert.equal(s.all("SELECT * FROM story_discussions").length, 0);
  assert.equal(storyDetail(s, p, key).id, key);
  for (const extra of [
    { preferences: [] },
    { ideas: "不要附在导入请求" },
    { style: "ink" },
  ])
    assert.throws(() =>
      importStory(
        s,
        { source: "text", text: "原文", importKey: randomUUID(), ...extra },
        p,
      ),
    );
  assert.equal(s.all("SELECT * FROM story_sources").length, 1);
  const empty = startStoryDiscussion(s, p, key);
  assert.match(
    String(
      s.one("SELECT content FROM messages WHERE id=?", empty.messageId)
        ?.content,
    ),
    /制作偏好尚未填写/,
  );
});

test("database catalog controls labels, ordering and validation without a code change or reseeding", (t) => {
  const { s, p, key } = setup(t);
  assert.equal(listStoryPreferences(s).length, 6);
  s.run(
    "INSERT INTO story_preference_categories VALUES('tone','叙事基调','偏好的叙事气氛',-1,1)",
  );
  s.run(
    "INSERT INTO story_preference_options VALUES('tone','warm','温暖治愈',NULL,0,1)",
  );
  s.run(
    "UPDATE story_preference_options SET enabled=0 WHERE category_id='style' AND value='ink'",
  );
  s.run("UPDATE story_preference_categories SET enabled=0 WHERE id='platform'");
  assert.equal(listStoryPreferences(s)[0].id, "tone");
  assert.ok(!listStoryPreferences(s).some((c) => c.id === "platform"));
  assert.throws(() =>
    startStoryDiscussion(s, p, key, {
      preferences: [{ category: "style", option: "ink", detail: "" }],
    }),
  );
  assert.throws(() =>
    startStoryDiscussion(s, p, key, {
      preferences: [{ category: "platform", option: "douyin", detail: "" }],
    }),
  );
  const first = startStoryDiscussion(s, p, key, {
    preferences: [{ category: "tone", option: "warm", detail: "" }],
  });
  const text = String(
    s.one("SELECT content FROM messages WHERE id=?", first.messageId)?.content,
  );
  assert.match(text, /叙事基调：温暖治愈/);
  s.run(
    "UPDATE story_preference_options SET label='新的选项文案',enabled=0 WHERE category_id='tone'",
  );
  const reopened = new Store(s.root);
  try {
    assert.equal(
      reopened.one(
        "SELECT label FROM story_preference_options WHERE category_id='tone'",
      )?.label,
      "新的选项文案",
    );
    assert.ok(!listStoryPreferences(reopened).some((c) => c.id === "tone"));
    assert.deepEqual(
      startStoryDiscussion(reopened, p, key, {
        preferences: [{ category: "tone", option: "warm", detail: "" }],
      }),
      first,
    );
    assert.equal(
      reopened.one("SELECT content FROM messages WHERE id=?", first.messageId)
        ?.content,
      text,
    );
  } finally {
    reopened.close();
  }
});

test("legacy briefs are preserved but never read as message input or story settings", (t) => {
  const { s, p, key } = setup(t);
  s.run(
    "INSERT INTO story_intake_briefs VALUES(?,?,?,?)",
    key,
    JSON.stringify([{ category: "style", option: "ink", detail: "" }]),
    "历史偏好",
    "2026-09-15",
  );
  assert.equal(storyDetail(s, p, key).brief, undefined);
  const discussion = startStoryDiscussion(s, p, key, { ideas: "当前聊天想法" });
  const content = String(
    s.one("SELECT content FROM messages WHERE id=?", discussion.messageId)
      ?.content,
  );
  assert.match(content, /当前聊天想法/);
  assert.doesNotMatch(content, /历史偏好|国风水墨/);
  assert.equal(
    s.one("SELECT ideas FROM story_intake_briefs WHERE story_id=?", key)?.ideas,
    "历史偏好",
  );
});
