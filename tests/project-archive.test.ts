import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/db";
import {
  createProject,
  createDocument,
  listProjects,
  archiveProject,
} from "../src/server/project-service";
test("archive removes a project from the daily directory while preserving its records and restoration", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-archive-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProject(s, { name: "旧验收资料" }).id);
  createDocument(s, p, {
    title: "原始记录",
    kind: "note",
    content: "应完整保留",
  });
  archiveProject(s, p, true);
  archiveProject(s, p, true);
  assert.equal(listProjects(s).length, 0);
  assert.equal(listProjects(s, true).length, 1);
  assert.equal(
    s.one("SELECT content FROM documents WHERE project_id=?", p)?.content,
    "应完整保留",
  );
  archiveProject(s, p, false);
  assert.equal(listProjects(s).length, 1);
  assert.equal(listProjects(s, true).length, 0);
});
