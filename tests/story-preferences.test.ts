import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/db";
import { importStory, storyDetail } from "../src/server/story-service";
import { startStoryDiscussion } from "../src/server/story-discussion";
import { workspace } from "../src/server/read-service";

test("only selected categories are saved and discussed; invalid and cross-category options are rejected", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-preferences-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const preferences = [
    { category: "scope", option: "selected", detail: "第一章到第三章" },
    { category: "adaptation", option: "faithful", detail: "" },
    { category: "duration", option: "other", detail: "每集大约 8 分钟" },
  ];
  const result = importStory(s, {
    source: "text",
    text: "原文",
    preferences,
    ideas: "保留结局",
    importKey: randomUUID(),
  });
  const p = String(result.project.id);
  assert.deepEqual(result.story.brief, { preferences, ideas: "保留结局" });
  startStoryDiscussion(s, p, String(result.story.id));
  const content = String(workspace(s, p).messages[0].content);
  assert.match(content, /第一章到第三章/);
  assert.match(content, /尽量忠实原文/);
  assert.match(content, /每集大约 8 分钟/);
  assert.doesNotMatch(content, /画面风格|发布平台|画幅/);
  const empty = importStory(
    s,
    {
      source: "text",
      text: "另一篇",
      preferences: [],
      importKey: randomUUID(),
    },
    p,
  );
  assert.deepEqual(empty.story.brief, { preferences: [], ideas: "" });
  const handoff = startStoryDiscussion(s, p, String(empty.story.id));
  assert.match(
    String(
      workspace(s, p).messages.find((m) => m.id === handoff.messageId)!.content,
    ),
    /制作偏好尚未填写/,
  );
  const count = s.all("SELECT id FROM story_sources").length;
  for (const invalid of [
    [{ category: "unknown", option: "discuss", detail: "" }],
    [{ category: "scope", option: "portrait", detail: "" }],
    [{ category: "scope", option: "selected", detail: "" }],
    [{ category: "aspect", option: "portrait", detail: "隐藏的旧自定义内容" }],
    [preferences[0], preferences[0]],
  ])
    assert.throws(() =>
      importStory(
        s,
        {
          source: "text",
          text: "无效请求",
          preferences: invalid,
          importKey: randomUUID(),
        },
        p,
      ),
    );
  assert.throws(() =>
    importStory(
      s,
      {
        source: "text",
        text: "重复风格来源",
        style: "ink",
        preferences: [],
        importKey: randomUUID(),
      },
      p,
    ),
  );
  assert.equal(s.all("SELECT id FROM story_sources").length, count);
});

test("legacy style data migrates once and old retry hashes remain valid", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-preference-migration-"));
  let s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const input = {
    source: "text",
    title: "旧项目",
    text: "旧故事",
    style: "other",
    customStyle: "木偶动画",
    ideas: "先做一集",
    importKey: randomUUID(),
  };
  const result = importStory(s, input),
    key = String(result.story.id),
    p = String(result.project.id);
  const sha = createHash("sha256").update(input.text).digest("hex");
  const oldHash = createHash("sha256")
    .update(
      JSON.stringify([
        null,
        "text",
        input.title,
        `${input.title}.txt`,
        sha,
        {
          style: input.style,
          customStyle: input.customStyle,
          ideas: input.ideas,
        },
      ]),
    )
    .digest("hex");
  s.run("UPDATE story_sources SET request_hash=? WHERE id=?", oldHash, key);
  s.run("DELETE FROM story_intake_briefs WHERE story_id=?", key);
  s.run(
    "INSERT INTO story_briefs VALUES(?,?,?,?,?)",
    key,
    input.style,
    input.customStyle,
    input.ideas,
    "2026-09-15",
  );
  s.run("DELETE FROM schema_migrations WHERE version=7");
  s.close();
  s = new Store(root);
  assert.deepEqual(storyDetail(s, p, key).brief, {
    preferences: [{ category: "style", option: "other", detail: "木偶动画" }],
    ideas: input.ideas,
  });
  assert.equal(importStory(s, input).story.id, key);
  s.close();
  s = new Store(root);
  assert.equal(s.all("SELECT * FROM story_intake_briefs").length, 1);
});
