import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getStore, Store } from "../src/server/db";
import {
  importStory,
  listStories,
  storyDetail,
  storyFile,
} from "../src/server/story-service";
import { workspace } from "../src/server/read-service";
import { handleApi } from "../src/server/api";
import { STORY_MAX_BYTES } from "../src/shared/story-import";

test("story import persists exact sources across restart and scopes retrieval; retries do not duplicate", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-story-"));
  let s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const text = "  第一章\r\n\r\n少年提着灯，走进旧宅。\n尾行空格  ";
  const input = {
    source: "text",
    text,
    title: "原始故事",
    importKey: randomUUID(),
  };
  const imported = importStory(s, input);
  const p = String(imported.project.id),
    key = String(imported.story.id);
  assert.equal(workspace(s, p).nodes.length, 1);
  assert.equal(workspace(s, p).messages.length, 0);
  assert.equal(workspace(s, p).stories.length, 1);
  assert.equal(importStory(s, input).story.id, key);
  assert.equal(s.all("SELECT * FROM projects").length, 1);
  assert.throws(
    () => importStory(s, { ...input, text: "改了内容" }),
    /内容已改变/,
  );
  s.close();
  s = new Store(root);
  assert.equal(storyDetail(s, p, key).content, undefined);
  assert.equal(storyDetail(s, p, key).preview_message, undefined);
  assert.deepEqual(storyFile(s, p, key).bytes, Buffer.from(text));
  assert.equal(listStories(s, p)[0].file_key, undefined);
  assert.equal(storyDetail(s, p, key).request_hash, undefined);

  const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0xff, 0, 0x81]);
  const file = importStory(
    s,
    { source: "file", name: "故事.docx", bytes, importKey: randomUUID() },
    p,
  );
  assert.deepEqual(
    storyFile(s, p, String(file.story.id)).bytes,
    Buffer.from(bytes),
  );
  assert.equal(file.story.content, undefined);
  const other = importStory(s, {
    source: "text",
    text: "另一部故事",
    importKey: randomUUID(),
  });
  assert.throws(() => storyDetail(s, String(other.project.id), key), /不存在/);
  assert.deepEqual(storyFile(s, p, key).bytes, Buffer.from(text));
  assert.equal(listStories(s, p).length, 2);

  const legacy = importStory(
    s,
    {
      source: "file",
      name: "旧编码.txt",
      bytes: new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]),
      importKey: randomUUID(),
    },
    p,
  );
  assert.equal(legacy.story.content, undefined);
  assert.equal(legacy.story.preview_message, undefined);
  assert.deepEqual(
    storyFile(s, p, String(legacy.story.id)).bytes,
    Buffer.from([0xc4, 0xe3, 0xba, 0xc3]),
  );
  const bom = importStory(
    s,
    {
      source: "file",
      name: "中文.txt",
      bytes: Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("你好", "utf16le"),
      ]),
      importKey: randomUUID(),
    },
    p,
  );
  assert.equal(bom.story.content, undefined);
  assert.deepEqual(
    storyFile(s, p, String(bom.story.id)).bytes,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好", "utf16le")]),
  );

  // Metadata lookup and retry must not open or parse stored content.
  const stored = storyFile(s, p, key);
  const filename = path.join(root, "files", String(stored.row.file_key));
  renameSync(filename, filename + ".held");
  try {
    assert.equal(storyDetail(s, p, key).id, key);
    assert.equal(importStory(s, input).story.id, key);
    assert.throws(() => storyFile(s, p, key), /ENOENT/);
  } finally {
    renameSync(filename + ".held", filename);
  }
});

test("invalid imports and database failures leave no projects, stories or files", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-story-failure-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const base = { source: "text", text: "可用故事", importKey: randomUUID() };
  assert.throws(() => importStory(s, { ...base, text: " \r\n " }));
  assert.throws(
    () =>
      importStory(s, {
        source: "file",
        name: "空.txt",
        bytes: new Uint8Array(),
        importKey: randomUUID(),
      }),
    /不能为空/,
  );
  assert.throws(
    () =>
      importStory(s, {
        source: "file",
        name: "超大.txt",
        bytes: new Uint8Array(STORY_MAX_BYTES + 1),
        importKey: randomUUID(),
      }),
    /20 MB/,
  );
  assert.throws(
    () =>
      importStory(s, {
        source: "file",
        name: "程序.exe",
        bytes: new Uint8Array([1]),
        importKey: randomUUID(),
      }),
    /请选择/,
  );
  assert.throws(() => importStory(s, base, randomUUID()), /不存在/);
  s.db.exec(
    "CREATE TRIGGER reject_story BEFORE INSERT ON story_sources BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  assert.throws(() => importStory(s, base), /test failure/);
  for (const table of [
    "projects",
    "workflows",
    "nodes",
    "agents",
    "sessions",
    "story_sources",
    "audit_events",
  ])
    assert.equal(s.all(`SELECT * FROM ${table}`).length, 0, table);
  assert.deepEqual(readdirSync(path.join(root, "files")), []);
});

test("multipart APIs import, list, read and download both paths with project isolation", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-story-http-"));
  process.env.DATA_DIR = root;
  const token = process.env.WORKBENCH_TOKEN;
  delete process.env.WORKBENCH_TOKEN;
  t.after(() => {
    getStore().close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
    if (token) process.env.WORKBENCH_TOKEN = token;
  });
  const request = (
    parts: string[],
    body?: FormData | object,
    origin = "http://localhost:3000",
  ) =>
    handleApi(
      new Request(`http://localhost:3000/api/v1/${parts.join("/")}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          ...(body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      }),
      parts,
    );
  const form = {
    source: "text",
    text: "  故事原文\n第二行  ",
    importKey: randomUUID(),
  };
  assert.equal(
    (
      await request(
        ["projects", "import-story"],
        form,
        "https://foreign.example",
      )
    ).status,
    403,
  );
  const response = await request(["projects", "import-story"], form);
  assert.equal(response.status, 200);
  const { data } = await response.json();
  const base = ["projects", data.project.id, "stories"];
  assert.equal((await (await request(base)).json()).data.length, 1);
  assert.equal(
    (await (await request([...base, data.story.id])).json()).data.content,
    undefined,
  );
  const download = await request([...base, data.story.id, "download"]);
  assert.equal(await download.text(), "  故事原文\n第二行  ");
  assert.match(download.headers.get("content-disposition")!, /^attachment/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  const upload = new FormData();
  upload.set("source", "file");
  upload.set("file", new File(["# 原故事\n\n内容"], "原文.md"));
  upload.set("importKey", randomUUID());
  const second = await request(base, upload);
  assert.equal(second.status, 200);
  const uploaded = (await second.json()).data.story;
  assert.equal(uploaded.brief, undefined);
  const handoff = await request([...base, uploaded.id, "discussion"], {
    preferences: [
      { category: "style", option: "other", detail: "定格纸偶" },
      { category: "scope", option: "first_episode", detail: "" },
    ],
    ideas: "先做开头这一段",
  });
  assert.equal(handoff.status, 200);
  const discussion = (await handoff.json()).data;
  assert.equal(discussion.execution, "not_configured");
  const message = getStore().one(
    "SELECT content FROM messages WHERE id=?",
    discussion.messageId,
  );
  assert.match(String(message?.content), /定格纸偶/);
  assert.match(String(message?.content), /先做开头这一段/);
  assert.equal(getStore().all("SELECT * FROM story_intake_briefs").length, 0);
  assert.deepEqual(
    (await (await request([...base, uploaded.id, "discussion"], {})).json())
      .data,
    discussion,
  );
  assert.equal(uploaded.content, undefined);
  assert.equal(uploaded.preview_message, undefined);
  assert.equal(
    await (await request([...base, uploaded.id, "download"])).text(),
    "# 原故事\n\n内容",
  );
  assert.equal(
    (await request(["projects", randomUUID(), "stories", data.story.id]))
      .status,
    404,
  );
  assert.equal(
    (await request([...base, data.story.id, "download", "extra"])).status,
    404,
  );
  const missingFile = new FormData();
  missingFile.set("source", "file");
  missingFile.set("importKey", randomUUID());
  assert.equal((await request(base, missingFile)).status, 400);
  const catalog = await request(["story-preferences"]);
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).data.length, 6);
});
