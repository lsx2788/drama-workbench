import test from "node:test";
import assert from "node:assert/strict";
import {
  groupProjectReferences,
  referenceCount,
} from "../src/client/project-references";
import type { Workspace } from "../src/client/api";
import { hasStoryKnowledge, storyRecords } from "../src/client/story-records";

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
test("story information exists only after real records or knowledge have been saved", () => {
  const w = workspace();
  w.preparation = { workflow_id: "draft" };
  assert.equal(hasStoryKnowledge(w), false);
  w.knowledge = { entities: [], relations: [], proposals: [] };
  assert.equal(hasStoryKnowledge(w), false);
  w.knowledge.proposals = [{ id: "proposal", summary: "新增人物" }];
  assert.equal(hasStoryKnowledge(w), true);
  w.knowledge = { entities: [{ code: "hero", name: "云澜" }] };
  assert.equal(hasStoryKnowledge(w), true);
});
test("side references are a current-library subset, excluding unrelated media and technical records", () => {
  const w = workspace();
  w.preparationRecords = [
    {
      id: "overview",
      kind: "overview",
      title: "原作概况",
      revision: 1,
      decision: "confirmed",
    },
  ];
  w.stories = [{ id: "original", original_name: "原文.docx" }];
  w.agents = [{ id: "agent", name: "总控", instructions: "提示词" }];
  w.items = [{ id: "task", title: "其他环节任务" }];
  w.assets = [
    { id: "hero", kind: "character", name: "云澜" },
    { id: "current", kind: "image", name: "当前参考图" },
    { id: "other", kind: "video", name: "其他分集视频" },
  ];
  w.assetVersions = w.assets.map((a) => ({
    id: `${a.id}-v1`,
    asset_id: a.id,
    version: 1,
    status: "approved",
  }));
  w.messages = [
    {
      session_id: "child",
      group: { group_id: "current-chat" },
      images: [{ version_id: "current-v1" }],
    },
    { session_id: "other-chat", images: [{ version_id: "other-v1" }] },
  ];
  const result = groupProjectReferences(w, "current-chat");
  assert.deepEqual(
    result.confirmed.assets.map((a) => a.record.id),
    ["hero", "current"],
  );
  const library = storyRecords(w);
  assert.ok(library.some((r) => r.id === "other"));
  assert.ok(library.some((r) => r.type === "prompt"));
  assert.ok(library.some((r) => r.type === "item"));
  assert.equal(
    result.confirmed.records[0],
    library.find((r) => r.id === "overview")?.source,
  );
  assert.equal(
    result.sources[0],
    library.find((r) => r.id === "original")?.source,
  );
  assert.equal(referenceCount(result.confirmed), 3);
});
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
