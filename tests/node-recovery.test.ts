import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { NodePipeline } from "../src/server/ai/node-pipeline";
import { recoverOrphanedNodes } from "../src/server/ai/node-recovery";
import { AiRuntime } from "../src/server/ai/runtime";

function fixture(t: any) {
  const folder = mkdtempSync(path.join(tmpdir(), "drama-recovery-"));
  const db = new Database(folder),
    service = new StudioService(db);
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const p = service.create("中断恢复", "原文", []);
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES('parent',?,'running',?,?)",
    p,
    process.pid,
    new Date().toISOString(),
  );
  const pipeline = new NodePipeline(service),
    job = pipeline.start(p, "source", "分析原文", "parent");
  service.act(
    p,
    "source",
    { type: "save", text: "已保存的产出" },
    { role: "executor", taskId: "source" },
    0,
  );
  pipeline.set(job, "reviewing");
  db.run("UPDATE runs SET status='completed' WHERE id='parent'");
  db.run(
    "INSERT INTO runs(id,project_id,parent_id,status,process_id,started_at) VALUES('child',?,'parent','interrupted',?,?)",
    p,
    process.pid,
    new Date().toISOString(),
  );
  return { db, service, p, job, pipeline };
}
test("explicit recovery queues one system handoff, never a fabricated user reply", (t) => {
  const { db, service, p, job } = fixture(t);
  const runtime = new AiRuntime(service);
  const queued = runtime.queueInterruptedRecovery(p, job);
  assert.equal(queued.created, true);
  assert.deepEqual(runtime.queueInterruptedRecovery(p, job), {
    id: queued.id,
    created: false,
  });
  const entry = db.one<{ role: string; audience: string }>(
    "SELECT m.role,d.audience FROM runs r JOIN messages m ON m.id=r.message_id JOIN message_details d ON d.message_id=m.id WHERE r.id=?",
    queued.id,
  );
  assert.deepEqual(entry && { ...entry }, {
    role: "system",
    audience: "agents",
  });
  assert.equal(service.project(p).tasks.source.delivery, "draft");
});
test("runtime releases orphaned review lock once, preserving output and allowing the same job to resume", (t) => {
  const { db, service, p, job, pipeline } = fixture(t);
  const before = service.project(p).tasks.source;
  new AiRuntime(service).recover();
  assert.equal(pipeline.job(p, job).status, "paused");
  assert.deepEqual(service.project(p).tasks.source, before);
  assert.equal(db.all("SELECT * FROM reviews").length, 0);
  assert.deepEqual(recoverOrphanedNodes(db), []);
  assert.equal(
    db.all("SELECT * FROM events WHERE action='recover-execution'").length,
    1,
  );
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES('next',?,'running',?,?)",
    p,
    process.pid,
    new Date().toISOString(),
  );
  assert.equal(pipeline.start(p, "source", "继续审核已有产出", "next"), job);
  assert.equal(pipeline.job(p, job).status, "working");
});
test("a live child or coordinator prevents orphan recovery even if its parent ended", (t) => {
  const { db, job, p, pipeline } = fixture(t);
  db.run("UPDATE runs SET status='running' WHERE id='child'");
  assert.deepEqual(recoverOrphanedNodes(db), []);
  assert.equal(pipeline.job(p, job).status, "reviewing");
  db.run("UPDATE runs SET status='completed' WHERE id='child'");
  db.run("UPDATE runs SET status='running' WHERE id='parent'");
  assert.deepEqual(recoverOrphanedNodes(db), []);
});
test("an escalated question remains waiting and duplicate delegation explains how to answer it", (t) => {
  const { db, service, p, job, pipeline } = fixture(t);
  const q = pipeline.question(
    p,
    job,
    { role: "executor", taskId: "source" },
    "范围需确认",
  );
  pipeline.decide(
    p,
    job,
    { role: "reviewer", taskId: "source" },
    q.questionId,
    true,
    "需总控决定",
  );
  recoverOrphanedNodes(db);
  assert.equal(pipeline.job(p, job).status, "waiting");
  assert.throws(
    () => pipeline.start(p, "source", "重派", "parent"),
    /answer_question/,
  );
  assert.equal(service.project(p).tasks.source.delivery, "draft");
  assert.deepEqual(recoverOrphanedNodes(db), []);
});
