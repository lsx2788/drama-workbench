import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/db";
import { seedDemo } from "../scripts/seed-demo";
import { structureQinghe } from "../scripts/structure-qinghe";
import { workspace } from "../src/server/read-service";
import {
  searchAssets,
  assetDetail,
  getFile,
} from "../src/server/asset-service";
import { layoutWorkflow } from "../src/client/workflow-layout";
import { storyRecords } from "../src/client/story-records";

test("complete demo preserves age variants, real files, lineage and planned production on repeat", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-demo-"));
  const s = new Store(root);
  t.after(() => {
    s.close();
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(resolved, { recursive: true, force: true });
  });
  const p = seedDemo(s),
    w = workspace(s, p);
  assert.equal(w.nodes.length, 16);
  assert.equal(w.overview.workflow?.status, "active");
  assert.ok(w.nodes.every((n) => n.status === "planned"));
  assert.equal(w.runs.length, 0);
  assert.equal(w.messages.length, 0);
  assert.ok(w.sessions.every((ss) => ss.external_session_id === null));
  const graph = layoutWorkflow(
    w.nodes.map((n) => ({ id: String(n.id) })),
    w.dependencies.map((d) => ({
      from: String(d.depends_on),
      to: String(d.node_id),
    })),
    "vertical",
  );
  assert.equal(graph.hasCycle, false);
  for (const e of graph.edges)
    assert.ok(
      graph.nodes.find((n) => n.id === e.from)!.y <
        graph.nodes.find((n) => n.id === e.to)!.y,
    );
  const young = searchAssets(s, p, {
    entityKey: "shen-yan",
    kind: "character",
    attributes: { age: 20 },
  });
  const older = searchAssets(s, p, {
    entityKey: "shen-yan",
    kind: "character",
    attributes: { age: 40 },
  });
  assert.equal(young.length, 1);
  assert.equal(older.length, 1);
  assert.notEqual(young[0].id, older[0].id);
  const composite = assetDetail(
    s,
    p,
    String(searchAssets(s, p, { code: "CMP-SY20-SWORD" })[0].id),
  );
  assert.deepEqual(composite.versions[0].sources.map((v) => v.code).sort(), [
    "CHR-SY-20",
    "PRP-SWORD",
  ]);
  for (const asset of w.assets) {
    const detail = assetDetail(s, p, String(asset.id));
    for (const v of detail.versions) {
      if (["image", "audio", "video"].includes(String(asset.kind))) {
        assert.equal(v.status, "candidate");
        assert.equal(v.files.length, 0);
      } else {
        assert.equal(v.status, "approved");
        assert.match(String(v.approval_scope), /演示文字/);
        assert.ok(v.files.length);
        for (const f of v.files)
          assert.equal(
            JSON.parse(getFile(s, p, String(f.id)).bytes.toString()).demo,
            true,
          );
      }
    }
  }
  const records = storyRecords(w);
  for (const category of [
    "故事文稿",
    "人物",
    "场景",
    "道具与服装",
    "组合资产",
    "制作资料",
    "图片",
    "音频",
    "视频",
    "讨论与决策",
    "任务与执行",
  ])
    assert.ok(records.some((r) => r.category === category));
  assert.equal(seedDemo(s), p);
  assert.equal(workspace(s, p).assets.length, w.assets.length);
  structureQinghe(s, p);
  const structured = workspace(s, p);
  assert.equal(structured.nodes.length, 36);
  assert.equal(structured.sections.filter((g) => g.phase === "unit").length, 3);
  for (const old of w.nodes)
    assert.ok(structured.nodes.some((n) => n.id === old.id));
  for (const old of w.sessions)
    assert.ok(structured.sessions.some((ss) => ss.id === old.id));
  assert.equal(structured.assets.length, w.assets.length);
  const upgradedGraph = layoutWorkflow(
    structured.nodes.map((n) => ({ id: String(n.id) })),
    structured.dependencies.map((d) => ({
      from: String(d.depends_on),
      to: String(d.node_id),
    })),
  );
  assert.equal(upgradedGraph.hasCycle, false);
  structureQinghe(s, p);
  assert.equal(workspace(s, p).nodes.length, 36);
});
