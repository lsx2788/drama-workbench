import test from "node:test";
import assert from "node:assert/strict";
import {
  groupProjectReferences,
  referenceCount,
} from "../src/client/project-references";
import type { Workspace } from "../src/client/api";

function workspace(): Workspace {
  return {
    overview: {
      project: { id: "project" },
      workflow: null,
      stages: [],
      counts: { assets: 0, approved: 0, items: 0 },
      blockers: [],
      pendingReviews: [],
    },
    documents: [],
    stories: [],
    workflows: [],
    sections: [],
    seasons: [],
    nodes: [],
    dependencies: [],
    agents: [],
    sessions: [],
    messages: [],
    highlights: [],
    items: [],
    assets: [],
    approvedVersions: [],
    runs: [],
    skills: [],
    audit: [],
  };
}
test("right panel retains confirmed baseline beside newer draft, then replaces it on confirmation", () => {
  const w = workspace();
  w.preparationRecords = [
    { id: "r1", kind: "requirements", revision: 1, decision: "confirmed" },
    {
      id: "r2",
      kind: "requirements",
      revision: 2,
      previous_id: "r1",
      decision: "changes_requested",
    },
  ];
  let grouped = groupProjectReferences(w);
  assert.deepEqual(
    grouped.confirmed.records.map((r) => r.id),
    ["r1"],
  );
  assert.deepEqual(
    grouped.discussing.records.map((r) => r.id),
    ["r2"],
  );
  w.preparationRecords[1].decision = "confirmed";
  grouped = groupProjectReferences(w);
  assert.deepEqual(
    grouped.confirmed.records.map((r) => r.id),
    ["r2"],
  );
  assert.equal(referenceCount(grouped.discussing), 0);
});
test("asset certainty is bound to an actual version; newer candidates do not inherit approval", () => {
  const w = workspace();
  w.assets = [
    {
      id: "a",
      code: "A",
      name: "云澜",
      kind: "character",
      approved_version: 2,
    },
    { id: "empty", code: "B", name: "空登记", kind: "image" },
  ];
  w.assetVersions = [
    { id: "v1", asset_id: "a", version: 1, status: "candidate" },
    { id: "v2", asset_id: "a", version: 2, status: "approved" },
    { id: "v3", asset_id: "a", version: 3, status: "candidate" },
    { id: "v4", asset_id: "a", version: 4, status: "rejected" },
  ];
  const grouped = groupProjectReferences(w);
  assert.deepEqual(
    grouped.confirmed.assets.map((a) => a.version.id),
    ["v2"],
  );
  assert.deepEqual(
    grouped.discussing.assets.map((a) => a.version.id),
    ["v3"],
  );
  assert.equal(
    referenceCount(grouped.confirmed) + referenceCount(grouped.discussing),
    2,
  );
});
test("empty groups stay empty; uploaded sources and unrecorded chat claims do not become confirmed facts", () => {
  const w = workspace();
  w.stories = [{ id: "source", original_name: "原文.txt" }];
  w.messages = [{ id: "message", content: "已经确定所有内容" }];
  let grouped = groupProjectReferences(w);
  assert.equal(
    referenceCount(grouped.confirmed) + referenceCount(grouped.discussing),
    0,
  );
  w.highlights = [
    { id: "old", status: "superseded" },
    { id: "new", status: "confirmed", supersedes_id: "old" },
    { id: "pending", status: "proposed" },
  ];
  grouped = groupProjectReferences(w);
  assert.deepEqual(
    grouped.confirmed.highlights.map((r) => r.id),
    ["new"],
  );
  assert.deepEqual(
    grouped.discussing.highlights.map((r) => r.id),
    ["pending"],
  );
});
