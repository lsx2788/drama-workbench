import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { ImageService, imageSchema } from "../src/server/ai/images";
import { decodeGeneratedImage } from "../src/server/ai/image-provider";
import {
  imageInventory,
  imageUsage,
  recycleImage,
} from "../src/server/image-trash";
import { filePath, readMaterial } from "../src/server/files";
import { toolsForRole } from "../src/server/ai/prompts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const args = imageSchema.parse({
  name: "旧道具",
  prompt: "白色背景的道具",
  category: "道具",
  reuseReason: "无可复用图片",
});
function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-trash-"));
  const db = new Database(root),
    s = new StudioService(db),
    p = s.create("测试", "整理图片", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const run = () => {
    const id = randomUUID();
    db.run(
      "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
      id,
      p,
      process.pid,
      new Date().toISOString(),
    );
    return id;
  };
  const images = new ImageService(s, async () => decodeGeneratedImage(png));
  const id = images.task(p, args, "old-image");
  return { root, db, s, p, run, images, id };
}

test("trash persists, removes reuse candidates but retains bytes, history and approval; restore is idempotent", async (t) => {
  const { root, db, s, p, run, images, id } = fixture(t);
  const generation = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run(),
    "first",
  );
  const fileId = generation.fileId!;
  s.act(p, id, { type: "review" }, { role: "reviewer", taskId: id }, 1, "通过");
  s.act(p, id, { type: "accept" }, { role: "coordinator" }, 1, "通过");
  const reviews = db.all("SELECT * FROM reviews"),
    before = s.project(p).assets;
  assert.equal(before.length, 1);
  recycleImage(db, p, fileId, "trash", "当前要求不再使用此道具", {
    role: "coordinator",
  });
  assert.equal(s.project(p).assets.length, 0);
  assert.equal(s.outputFiles(p, id, 1).length, 0);
  assert.equal(s.snapshot().files[`${p}/${id}`], undefined);
  assert.equal(
    s.project(p).messages.find((m) => m.image)?.image?.file?.trashed,
    true,
  );
  assert.equal(
    imageInventory(db, p)[0].trash?.reason,
    "当前要求不再使用此道具",
  );
  assert.equal(existsSync(filePath(db, fileId)), true);
  assert.equal((await readMaterial(db, p, fileId)).kind, "image");
  const reopened = new Database(root);
  assert.equal(imageInventory(reopened, p)[0].trash?.actor, "coordinator");
  reopened.close();
  assert.equal(
    recycleImage(db, p, fileId, "trash", "重复请求", { role: "coordinator" })
      .changed,
    false,
  );
  recycleImage(db, p, fileId, "restore", "保留作为参考", { role: "human" });
  assert.deepEqual(s.project(p).assets, before);
  assert.deepEqual(db.all("SELECT * FROM reviews"), reviews);
  assert.equal(
    recycleImage(db, p, fileId, "restore", "重试", { role: "human" }).changed,
    false,
  );
  assert.equal(
    db.all(
      "SELECT * FROM events WHERE action IN ('image-trash','image-restore')",
    ).length,
    2,
  );
});

test("cross-project, raw source and other-node trash are denied; restoration never grants draft approval", async (t) => {
  const { db, s, p, run, images, id } = fixture(t);
  const g = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run(),
    "first",
  );
  const other = s.create("另一个剧本", "测试", []);
  assert.throws(
    () =>
      recycleImage(db, other, g.fileId!, "trash", "错误项目", {
        role: "human",
      }),
    /当前剧本/,
  );
  assert.throws(
    () =>
      recycleImage(db, p, g.fileId!, "trash", "错误节点", {
        role: "executor",
        taskId: "source",
      }),
    /自己节点/,
  );
  assert.throws(
    () => recycleImage(db, p, g.fileId!, "trash", " ", { role: "human" }),
    /理由/,
  );
  const sourceId = randomUUID();
  db.run(
    "INSERT INTO files VALUES(?,?,NULL,?,'image/png',1,'hash','source',?)",
    sourceId,
    p,
    "原始参考.png",
    new Date().toISOString(),
  );
  assert.throws(
    () => recycleImage(db, p, sourceId, "trash", "原始资料", { role: "human" }),
    /原始上传/,
  );
  recycleImage(db, p, g.fileId!, "trash", "旧版不需要", {
    role: "executor",
    taskId: id,
  });
  recycleImage(db, p, g.fileId!, "restore", "恢复", { role: "human" });
  assert.equal(s.project(p).tasks[id].delivery, "draft");
  assert.equal(s.project(p).assets.length, 0);
  for (const kind of ["source", "script", "storyboard"])
    assert.equal(
      toolsForRole("executor", kind).includes("recycle_image"),
      false,
    );
  assert.equal(toolsForRole("coordinator").includes("recycle_image"), true);
});

test("live references and node dependencies block trash, including active reference generation", async (t) => {
  const { db, s, p, run, images, id } = fixture(t);
  const g = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run(),
    "first",
  );
  s.act(p, id, { type: "review" }, { role: "reviewer", taskId: id }, 1, "通过");
  s.act(p, id, { type: "accept" }, { role: "coordinator" }, 1, "通过");
  const other = images.task(p, { ...args, name: "组合" }, "other");
  s.act(
    p,
    other,
    {
      type: "save",
      text: "复用旧道具",
      assetIds: [s.project(p).assets[0].id],
      reuseReason: "沿用",
    },
    { role: "executor", taskId: other },
    0,
  );
  assert.match(imageUsage(db, p, g.fileId!).join(), /资产引用/);
  assert.throws(
    () =>
      recycleImage(db, p, g.fileId!, "trash", "无用", { role: "coordinator" }),
    /仍在使用/,
  );
  s.act(
    p,
    other,
    { type: "save", text: "改为新建", assetIds: [], reuseReason: "换用新版" },
    { role: "executor", taskId: other },
    1,
  );
  db.run("INSERT INTO dependencies VALUES(?,?,?)", p, other, id);
  assert.match(imageUsage(db, p, g.fileId!).join(), /任务依赖/);
  db.run(
    "DELETE FROM dependencies WHERE project_id=? AND task_id=? AND input_id=?",
    p,
    other,
    id,
  );
  const msg = s.message(p, "资产制作 AI", "executor", "生成中", other);
  db.run(
    "INSERT INTO image_generations(id,project_id,task_id,run_id,call_id,message_id,prompt,name,aspect_ratio,reference_ids,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'prompt','正在生成','1:1',?,'generating','now','now')",
    randomUUID(),
    p,
    other,
    run(),
    "pending",
    msg,
    JSON.stringify([g.fileId]),
  );
  assert.throws(
    () => recycleImage(db, p, g.fileId!, "trash", "无用", { role: "human" }),
    /正在生成/,
  );
});

test("trashed images cannot be used by generation, and retired historic versions leave current version intact", async (t) => {
  const { db, s, p, run, images, id } = fixture(t);
  const first = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run(),
    "first",
  );
  const second = await images.generate(
    p,
    id,
    { ...args, revision: 1 },
    { role: "executor", taskId: id },
    run(),
    "second",
  );
  recycleImage(db, p, first.fileId!, "trash", "第二版已替代第一版", {
    role: "coordinator",
  });
  assert.equal(s.outputFiles(p, id, 2)[0].id, second.fileId);
  assert.equal(
    imageInventory(db, p).find((i) => i.file.id === first.fileId)?.current,
    false,
  );
  await assert.rejects(
    images.generate(
      p,
      id,
      { ...args, revision: 2, referenceFileIds: [first.fileId!] },
      { role: "executor", taskId: id },
      run(),
      "forbidden",
    ),
    /垃圾篓/,
  );
});
