import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import {
  storeChatImages,
  storeChatAttachments,
  readMaterial,
  discardUploads,
} from "../src/server/files";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import { resolveTaskReferences } from "../src/server/ai/task-references";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const file = () => new File([Buffer.from(png, "base64")], "参考.png");
function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-chat-upload-")),
    db = new Database(root),
    s = new StudioService(db),
    p = s.create("上传图片", "测试", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, db, s, p };
}
test("chat-only images persist against the real message, remain source references and retry without duplication", async (t) => {
  const { root, db, s, p } = fixture(t),
    ai = new AiRuntime(s),
    request = randomUUID();
  const uploads = await storeChatImages(db, [file()]);
  const run = ai.queue(p, "", request, undefined, undefined, uploads);
  await discardUploads(db, uploads);
  const message = s.project(p).messages.at(-1)!;
  assert.equal(message.text, "上传了图片。");
  assert.equal(message.attachments?.[0].id, uploads[0].id);
  assert.equal(s.project(p).sources.length, 1);
  assert.equal(s.project(p).assets.length, 0);
  assert.equal(
    resolveTaskReferences(db, p, [
      { fileId: uploads[0].id, purpose: "参考脸型" },
    ])[0].source,
    "original",
  );
  const retry = await storeChatImages(db, [file()]);
  assert.equal(
    ai.queue(p, "", request, undefined, undefined, retry).created,
    false,
  );
  await discardUploads(db, retry);
  assert.equal(readdirSync(path.join(root, "files")).length, 1);
  assert.equal(db.one<any>("SELECT COUNT(*) n FROM message_files").n, 1);
  assert.equal(
    db.one<any>("SELECT status FROM runs WHERE id=?", run.id).status,
    "queued",
  );
});
test("rejected busy upload leaves no message or orphan original", async (t) => {
  const { root, db, s, p } = fixture(t),
    ai = new AiRuntime(s);
  ai.queue(p, "处理文字", randomUUID());
  const uploads = await storeChatImages(db, [file()]);
  assert.throws(
    () => ai.queue(p, "新图", randomUUID(), undefined, undefined, uploads),
    /正在处理/,
  );
  await discardUploads(db, uploads);
  assert.equal(readdirSync(path.join(root, "files")).length, 0);
  assert.equal(db.one<any>("SELECT COUNT(*) n FROM message_files").n, 0);
});

test("mixed chat documents and images persist as references and retain readable text", async (t) => {
  const { db, s, p } = fixture(t);
  const uploads = await storeChatAttachments(db, [
    new File(["# 修改要求\n保留脸型，调整衣袖。"], "指导.md"),
    file(),
  ]);
  new AiRuntime(s).queue(p, "", randomUUID(), undefined, undefined, uploads);
  const message = s.project(p).messages.at(-1)!;
  assert.equal(message.text, "上传了参考文件。");
  assert.equal(message.attachments?.length, 2);
  const material = await readMaterial(db, p, uploads[0].id);
  assert.equal(material.kind, "text");
  assert.match((material as any).text, /调整衣袖/);
  assert.equal(
    resolveTaskReferences(db, p, [
      { fileId: uploads[0].id, purpose: "修改要求" },
    ])[0].file.name,
    "指导.md",
  );
  assert.equal(s.project(p).assets.length, 0);
  await assert.rejects(
    storeChatAttachments(db, [new File(["a"], "run.exe")]),
    /支持/,
  );
  await assert.rejects(
    storeChatAttachments(db, [new File([], "empty.md")]),
    /空文件/,
  );
  await assert.rejects(
    storeChatAttachments(db, [
      new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.txt"),
    ]),
    /20MB/,
  );
  await assert.rejects(
    storeChatAttachments(db, [
      new File([Buffer.from(png, "base64")], "fake.gif"),
    ]),
    /实际格式/,
  );
});
test("chat image validation rejects excess, nonimage and disguised formats", async (t) => {
  const { db } = fixture(t);
  await assert.rejects(
    storeChatImages(db, Array.from({ length: 6 }, file)),
    /5张/,
  );
  await assert.rejects(
    storeChatImages(db, [new File(["text"], "a.txt")]),
    /支持/,
  );
  await assert.rejects(
    storeChatImages(db, [new File([Buffer.from(png, "base64")], "a.webp")]),
    /实际格式/,
  );
  await assert.rejects(
    storeChatImages(db, [new File(["not an image"], "a.png")]),
  );
  await assert.rejects(
    storeChatImages(db, [
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "a.png"),
    ]),
    /10MB/,
  );
});
test("coordinator receives actual uploaded image bytes and file identity", async (t) => {
  const { db, s, p } = fixture(t);
  let input: any;
  const ai = new AiRuntime(s, () => {
    const c: AiConnection = {
      notices: new Set(),
      initialize: async () => {},
      close: () => {},
      onRequest: async () => ({}),
      request: async (method, params) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ model: "test", isDefault: true }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume")
          return { thread: { id: "upload" } };
        if (method === "turn/start") {
          input = params;
          for (const n of c.notices)
            n("turn/completed", {
              threadId: "upload",
              turn: { status: "completed" },
            });
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  const uploads = await storeChatImages(db, [file()]);
  await ai.start(
    ai.queue(p, "看看这个脸型", randomUUID(), undefined, undefined, uploads).id,
  );
  assert.ok(
    input.input.some(
      (x: any) =>
        x.type === "image" && x.url === `data:image/png;base64,${png}`,
    ),
  );
  assert.ok(input.input.some((x: any) => x.text?.includes(uploads[0].id)));
  assert.equal(s.project(p).run?.status, "completed");
});
