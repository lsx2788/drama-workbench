import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleApi } from "../src/server/api";
import { getStore } from "../src/server/db";
import { trashProject } from "../src/server/project-trash";
import { postHumanMessage } from "../src/server/collaboration-service";

test("trash requires confirmation, preserves data/files and sessions, blocks access, and restores idempotently", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-trash-"));
  process.env.DATA_DIR = root;
  delete process.env.WORKBENCH_TOKEN;
  t.after(() => {
    getStore().close();
    rmSync(root, { recursive: true, force: true });
  });
  const request = (parts: string[], method = "GET", body?: unknown) =>
    handleApi(
      new Request(`http://localhost/api/v1/${parts.join("/")}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      parts,
    );
  const p = (
    await (await request(["projects"], "POST", { name: "同名剧本" })).json()
  ).data.id;
  const other = (
    await (await request(["projects"], "POST", { name: "同名剧本" })).json()
  ).data.id;
  const s = getStore();
  const initial = (await (await request(["projects", p, "workspace"])).json())
    .data;
  const sid = initial.sessions[0].id;
  s.run(
    "UPDATE sessions SET external_session_id=? WHERE id=?",
    "native-preserved",
    sid,
  );
  // A raw file is retained without parsing or rewriting it during the state transition.
  const file = path.join(root, "files", "original.txt");
  writeFileSync(file, "原文不变");
  const snapshot = s.all("SELECT * FROM sessions WHERE id=?", sid);
  assert.equal(
    (await request(["projects", p], "DELETE", { confirmed: false })).status,
    400,
  );
  assert.equal((await request(["projects", p], "DELETE")).status, 400);
  assert.equal(
    (await request(["projects", p], "DELETE", { confirmed: true })).status,
    200,
  );
  assert.equal(
    (await request(["projects", p], "DELETE", { confirmed: true })).status,
    200,
  );
  assert.deepEqual(
    (await (await request(["projects"])).json()).data.map(
      (r: { id: string }) => r.id,
    ),
    [other],
  );
  assert.equal(
    (await (await request(["projects", "trash"])).json()).data[0].id,
    p,
  );
  assert.equal((await request(["projects", p, "workspace"])).status, 409);
  assert.equal(
    (await request(["projects", p, "documents"], "POST", { title: "不可写入" }))
      .status,
    409,
  );
  assert.deepEqual(s.all("SELECT * FROM sessions WHERE id=?", sid), snapshot);
  assert.equal(readFileSync(file, "utf8"), "原文不变");
  assert.equal((await request(["projects", p, "restore"], "POST")).status, 200);
  assert.equal((await request(["projects", p, "restore"], "POST")).status, 200);
  const restored = (await (await request(["projects", p, "workspace"])).json())
    .data;
  assert.equal(restored.sessions[0].id, sid);
  assert.equal(restored.sessions[0].external_session_id, "native-preserved");
  assert.equal(
    (await (await request(["projects", "trash"])).json()).data.length,
    0,
  );
  assert.equal(
    s.all("SELECT * FROM audit_events WHERE action='project.trashed'").length,
    1,
  );
  assert.equal(
    s.all("SELECT * FROM audit_events WHERE action='project.trash_restored'")
      .length,
    1,
  );
  // Deletion cannot orphan an in-flight AI turn.
  const message = String(
    postHumanMessage(s, p, sid, { content: "测试" }).message!.id,
  );
  s.run(
    "INSERT INTO ai_turns(id,project_id,session_id,message_id,request_key,request_hash,status,owner,config_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    "turn",
    p,
    sid,
    message,
    "key",
    "hash",
    "running",
    "test",
    "{}",
    new Date().toISOString(),
  );
  assert.throws(() => trashProject(s, p), /AI 正在处理/);
  assert.equal(s.all("SELECT * FROM project_trash").length, 0);
});
