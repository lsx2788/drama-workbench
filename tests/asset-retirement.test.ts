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
import { recyclePausedAsset } from "../src/server/asset-retirement";
import { imageInventory, recycleImage } from "../src/server/image-trash";
import { filePath } from "../src/server/files";
import { taskOutputState } from "../src/domain/output-status";
import { toolsForRole } from "../src/server/ai/prompts";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import type { RpcData } from "../src/server/ai/codex-rpc";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const args = imageSchema.parse({
  name: "已被替代的旧角色图",
  prompt: "白底角色",
  purpose: "穿衣首样",
  reuseReason: "创建测试图",
});
const coordinator = { role: "coordinator" } as const;
async function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-retire-"));
  const db = new Database(root),
    service = new StudioService(db),
    p = service.create("测试", "测试", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const run = randomUUID();
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
    run,
    p,
    process.pid,
    new Date().toISOString(),
  );
  const images = new ImageService(service, async () =>
    decodeGeneratedImage(png),
  );
  const id = images.task(p, args, "obsolete");
  const first = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run,
    "first",
  );
  const second = await images.generate(
    p,
    id,
    { ...args, revision: 1 },
    { role: "executor", taskId: id },
    run,
    "second",
  );
  const pause = () =>
    service.act(p, id, { type: "toggle-executor" }, coordinator, 2);
  const recycle = (action: "trash" | "restore" = "trash") =>
    recyclePausedAsset(
      service,
      p,
      id,
      2,
      action,
      "旧方案已被新版替代",
      coordinator,
    );
  return {
    root,
    db,
    service,
    p,
    id,
    first: first.fileId!,
    second: second.fileId!,
    run,
    pause,
    recycle,
  };
}

test("retiring a paused rejected asset is atomic, persistent and reversible without granting acceptance", async (t) => {
  const { root, db, service, p, id, first, second, pause, recycle } =
    await fixture(t);
  service.act(
    p,
    id,
    { type: "return", reason: "不符合新要求" },
    { role: "reviewer", taskId: id },
    2,
    "不符合新要求",
  );
  pause();
  recycleImage(db, p, first, "trash", "此前已单独淘汰", coordinator);
  const reviews = db.all("SELECT * FROM reviews"),
    outputs = db.all("SELECT * FROM outputs"),
    messages = db.all("SELECT * FROM messages");
  assert.equal(recycle().changed, true);
  assert.equal(recycle().changed, false);
  assert.equal(taskOutputState(service.project(p).tasks[id]), "retired");
  assert.equal(service.project(p).tasks[id].delivery, "returned");
  assert.equal(service.project(p).assets.length, 0);
  assert.equal(imageInventory(db, p).filter((i) => i.trash).length, 2);
  assert.ok(existsSync(filePath(db, second)));
  assert.throws(
    () => service.act(p, id, { type: "toggle-executor" }, coordinator, 2),
    /已清理/,
  );
  const reopened = new Database(root);
  assert.equal(
    new StudioService(reopened).project(p).tasks[id].retirement?.actor,
    "coordinator",
  );
  reopened.close();
  recycle("restore");
  assert.equal(recycle("restore").changed, false);
  assert.equal(taskOutputState(service.project(p).tasks[id]), "paused");
  assert.equal(service.project(p).assets.length, 0);
  assert.equal(
    imageInventory(db, p).find((i) => i.file.id === second)?.trash,
    undefined,
  );
  assert.ok(imageInventory(db, p).find((i) => i.file.id === first)?.trash);
  assert.deepEqual(db.all("SELECT * FROM reviews"), reviews);
  assert.deepEqual(db.all("SELECT * FROM outputs"), outputs);
  assert.deepEqual(db.all("SELECT * FROM messages"), messages);
  assert.equal(
    db.all(
      "SELECT * FROM events WHERE action IN ('asset-retire','asset-restore')",
    ).length,
    2,
  );
});

test("retirement rejects wrong role, revision, project, live dependencies and approved assets", async (t) => {
  const { db, service, p, id, pause, recycle } = await fixture(t);
  assert.throws(recycle, /先暂停/);
  pause();
  assert.throws(
    () =>
      recyclePausedAsset(service, p, id, 2, "trash", "请求", {
        role: "executor",
        taskId: id,
      }),
    /只有总控/,
  );
  assert.throws(
    () => recyclePausedAsset(service, p, id, 1, "trash", "请求", coordinator),
    /版本已变化/,
  );
  const other = service.create("其他", "测试", []);
  assert.throws(
    () =>
      recyclePausedAsset(service, other, id, 2, "trash", "请求", coordinator),
    /找不到/,
  );
  db.run("INSERT INTO dependencies VALUES(?,?,?)", p, "source", id);
  assert.throws(recycle, /依赖/);
  assert.equal(imageInventory(db, p).filter((i) => i.trash).length, 0);
  db.run("DELETE FROM dependencies WHERE project_id=? AND input_id=?", p, id);
  db.run(
    "INSERT INTO image_task_specs VALUES(?,?,?,?)",
    p,
    "source",
    "角色基础图",
    id,
  );
  assert.throws(recycle, /角色基准/);
  db.run(
    "DELETE FROM image_task_specs WHERE project_id=? AND task_id='source'",
    p,
  );
  pause();
  service.act(
    p,
    id,
    { type: "review" },
    { role: "reviewer", taskId: id },
    2,
    "通过",
  );
  service.act(p, id, { type: "accept" }, coordinator, 2, "通过");
  pause();
  assert.throws(recycle, /已验收/);
  assert.equal(service.project(p).assets.length, 1);
  assert.equal(imageInventory(db, p).filter((i) => i.trash).length, 0);
  assert.equal(
    toolsForRole("coordinator").includes("recycle_paused_asset"),
    true,
  );
  for (const role of ["executor", "reviewer"] as const)
    assert.equal(
      toolsForRole(role, "assets").includes("recycle_paused_asset"),
      false,
    );
});

test("retirement will not remove images used in a running generation and rolls back the whole cleanup", async (t) => {
  const { db, service, p, id, second, run, pause, recycle } = await fixture(t);
  pause();
  const message = service.message(p, "制作 AI", "executor", "生成中", "source");
  db.run(
    "INSERT INTO image_generations(id,project_id,task_id,run_id,call_id,message_id,prompt,name,aspect_ratio,reference_ids,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'prompt','引用旧图','1:1',?,'generating','now','now')",
    randomUUID(),
    p,
    "source",
    run,
    "pending",
    message,
    JSON.stringify([second]),
  );
  assert.throws(recycle, /正在生成/);
  assert.equal(service.project(p).tasks[id].retirement, undefined);
  assert.equal(imageInventory(db, p).filter((i) => i.trash).length, 0);
  assert.equal(
    db.all("SELECT * FROM events WHERE action='asset-retire'").length,
    0,
  );
});

test("coordinator tool requires real image reads, then retires the asset with recorded tool and audit results", async (t) => {
  const { db, service, p, id, first, second, pause } = await fixture(t);
  pause();
  let completed = false;
  const runtime = new AiRuntime(service, () => {
    const c: AiConnection = {
      notices: new Set(),
      onRequest: async () => ({}),
      initialize: async () => {},
      close: () => {},
      request: async (method, params: RpcData = {}) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ isDefault: true, model: "test" }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume") {
          assert.ok(
            (params.dynamicTools as any[]).some(
              (tool) => tool.name === "recycle_paused_asset",
            ),
          );
          return { thread: { id: "retirement-test" } };
        }
        if (method === "turn/start") {
          const call = (tool: string, args: unknown) =>
            c.onRequest("item/tool/call", {
              threadId: "retirement-test",
              tool,
              callId: randomUUID(),
              arguments: args,
            }) as Promise<any>;
          const args = {
            taskId: id,
            revision: 2,
            action: "trash",
            reason: "实际旧图与退回要求一致，已被新图替代",
          };
          assert.equal(
            (await call("recycle_paused_asset", args)).success,
            false,
          );
          for (const fileId of [first, second])
            assert.equal(
              (await call("read_material", { fileId })).success,
              true,
            );
          assert.equal(
            (await call("recycle_paused_asset", args)).success,
            true,
          );
          completed = true;
          for (const notice of c.notices)
            notice("turn/completed", {
              threadId: "retirement-test",
              turn: { status: "completed" },
            });
          return { turn: { id: "done" } };
        }
        return {};
      },
    };
    return c;
  });
  await runtime.start(
    runtime.queue(p, "清理不再需要的暂停资产", randomUUID()).id,
  );
  assert.ok(completed);
  assert.equal(taskOutputState(service.project(p).tasks[id]), "retired");
  assert.ok(
    db.one(
      "SELECT seq FROM raw_events WHERE kind='tool_call' AND body LIKE '%recycle_paused_asset%'",
    ),
  );
});
