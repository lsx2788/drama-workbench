import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/db";
import { importStoryBatch } from "../src/server/story-batch-service";
import { importStoryRequest } from "../src/server/story-import-request";
import { importStory, storyFile } from "../src/server/story-service";
import {
  startStoriesDiscussion,
  startStoryDiscussion,
} from "../src/server/story-discussion";
import { workspace } from "../src/server/read-service";
import { STORY_MAX_BYTES } from "../src/shared/story-import";

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-batch-"));
  const s = new Store(root);
  t.after(() => {
    if (s.db.isOpen) s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  return s;
}
const input = () => ({
  source: "files",
  title: "同一故事",
  importKey: randomUUID(),
  files: [
    { name: "第一章.txt", bytes: Buffer.from("  第一章\r\n保留原文  ") },
    {
      name: "人物.png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]),
    },
  ],
});

test("batch stores exact independent sources, preserves order, and sends one retryable handoff", (t) => {
  const s = setup(t),
    request = input();
  const result = importStoryBatch(s, request),
    p = String(result.project.id);
  const ids = result.stories.map((story) => String(story.id));
  assert.equal(s.all("SELECT * FROM projects").length, 1);
  assert.equal(workspace(s, p).messages.length, 0);
  assert.deepEqual(
    result.stories.map((story) => story.original_name),
    request.files.map((f) => f.name),
  );
  ids.forEach((key, index) =>
    assert.deepEqual(storyFile(s, p, key).bytes, request.files[index].bytes),
  );
  assert.deepEqual(importStoryBatch(s, request), result);
  assert.throws(
    () =>
      importStoryBatch(s, { ...request, files: [...request.files].reverse() }),
    /内容已改变/,
  );
  assert.equal(readdirSync(path.join(s.root, "files")).length, 2);
  const discussion = startStoriesDiscussion(s, p, ids, { ideas: "先讨论画幅" });
  assert.deepEqual(
    startStoriesDiscussion(s, p, ids, { ideas: "重试不改消息" }),
    discussion,
  );
  const w = workspace(s, p);
  assert.equal(w.messages.length, 1);
  assert.equal(w.sessions.length, 1);
  assert.deepEqual(
    w.messages[0].attachments.map((a) => a.id),
    ids,
  );
  const content = String(w.messages[0].content);
  for (const source of result.stories)
    assert.ok(content.includes(source.download_url));
  assert.ok(content.includes("先讨论画幅"));
  assert.ok(!content.includes("保留原文"));
  assert.equal(s.all("SELECT * FROM story_intake_briefs").length, 0);
  const third = importStory(
    s,
    { source: "text", text: "另一个文件", importKey: randomUUID() },
    p,
  );
  assert.throws(
    () => startStoriesDiscussion(s, p, [...ids, String(third.story.id)]),
    /其他交接/,
  );
  assert.throws(() => startStoriesDiscussion(s, p, [ids[0], ids[0]]), /不同/);
  const other = importStoryBatch(s, input());
  assert.throws(
    () => startStoriesDiscussion(s, String(other.project.id), ids),
    /不存在/,
  );
  assert.throws(
    () => importStoryBatch(s, request, String(other.project.id)),
    /内容已改变/,
  );
});

test("failed batch rolls back all files and project; failed handoff preserves the batch for retry", (t) => {
  const s = setup(t),
    request = input();
  assert.throws(() =>
    importStoryBatch(s, {
      ...request,
      files: [...request.files, { name: "bad.exe", bytes: Buffer.from("bad") }],
    }),
  );
  assert.equal(s.all("SELECT * FROM projects").length, 0);
  assert.equal(s.all("SELECT * FROM story_import_batches").length, 0);
  assert.equal(readdirSync(path.join(s.root, "files")).length, 0);
  s.db.exec(
    "CREATE TRIGGER fail_batch BEFORE INSERT ON story_import_batch_files WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'batch failure'); END;",
  );
  assert.throws(() => importStoryBatch(s, request), /batch failure/);
  assert.equal(s.all("SELECT * FROM story_sources").length, 0);
  assert.equal(readdirSync(path.join(s.root, "files")).length, 0);
  s.db.exec("DROP TRIGGER fail_batch;");
  const result = importStoryBatch(s, request),
    p = String(result.project.id),
    ids = result.stories.map((s) => String(s.id));
  s.db.exec(
    "CREATE TRIGGER fail_batch_handoff BEFORE INSERT ON story_discussions WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'handoff failure'); END;",
  );
  assert.throws(() => startStoriesDiscussion(s, p, ids), /handoff failure/);
  assert.equal(workspace(s, p).messages.length, 0);
  assert.equal(s.all("SELECT * FROM story_discussions").length, 0);
  assert.equal(readdirSync(path.join(s.root, "files")).length, 2);
  s.db.exec("DROP TRIGGER fail_batch_handoff;");
  startStoriesDiscussion(s, p, ids);
  assert.equal(workspace(s, p).messages.length, 1);
});

test("multipart batches retain all file fields, enforce limits, and reject silent single-file truncation", async (t) => {
  const s = setup(t);
  const form = new FormData();
  form.set("source", "files");
  form.set("importKey", randomUUID());
  form.append("file", new File(["一"], "one.txt"));
  form.append("file", new File(["二"], "two.md"));
  const request = () =>
    new Request("http://localhost/import", { method: "POST", body: form });
  const result = await importStoryRequest(s, request());
  assert.equal(workspace(s, String(result.project.id)).stories.length, 2);
  assert.deepEqual(await importStoryRequest(s, request()), result);
  form.set("source", "file");
  await assert.rejects(importStoryRequest(s, request()), /source=files/);
  assert.throws(() => importStoryBatch(s, { ...input(), files: [] }));
  assert.throws(() =>
    importStoryBatch(s, {
      ...input(),
      files: Array.from({ length: 21 }, () => ({
        name: "a.txt",
        bytes: Buffer.from("a"),
      })),
    }),
  );
  const large = { name: "large.txt", bytes: new Uint8Array(STORY_MAX_BYTES) };
  assert.throws(
    () => importStoryBatch(s, { ...input(), files: [large, large, large] }),
    /50 MB/,
  );
  assert.equal(s.all("SELECT * FROM projects").length, 1);
});

test("migration preserves legacy single-file chats and remains stable across restart", (t) => {
  const s = setup(t);
  const old = importStory(s, {
    source: "text",
    text: "旧原文",
    importKey: randomUUID(),
  });
  const p = String(old.project.id),
    key = String(old.story.id);
  const discussion = startStoryDiscussion(s, p, key);
  const before = workspace(s, p).messages[0];
  // Recreate the previous schema with an actual existing handoff.
  s.db
    .exec(`DROP TABLE story_import_batch_files; DROP TABLE story_import_batches;
    CREATE TABLE legacy_discussions(story_id TEXT PRIMARY KEY REFERENCES story_sources(id), message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),created_at TEXT NOT NULL);
    INSERT INTO legacy_discussions SELECT story_id,message_id,created_at FROM story_discussions;
    DROP TABLE story_discussions; ALTER TABLE legacy_discussions RENAME TO story_discussions;
    DELETE FROM schema_migrations WHERE version=11;`);
  s.close();
  const reopened = new Store(s.root);
  assert.deepEqual(startStoryDiscussion(reopened, p, key), discussion);
  assert.deepEqual(workspace(reopened, p).messages[0], before);
  const batch = importStoryBatch(reopened, input(), p);
  startStoriesDiscussion(
    reopened,
    p,
    batch.stories.map((s) => String(s.id)),
  );
  reopened.close();
  const again = new Store(s.root);
  assert.equal(workspace(again, p).messages.length, 2);
  assert.equal(again.all("PRAGMA foreign_key_check").length, 0);
  again.close();
});
