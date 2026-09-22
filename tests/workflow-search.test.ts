import assert from "node:assert/strict";
import test from "node:test";
import { buildProject } from "../src/mocks/fixtures";
import { searchWorkflow } from "../src/features/workflow/search";

test("episode number searches are exact, including leading zeros and Chinese labels", () => {
  const project = buildProject();
  for (const query of ["1", "01", "第 1 集", "EP01"]) {
    assert.deepEqual(
      searchWorkflow(project, "episode", query).map((r) => r.episode),
      [1],
    );
  }
  assert.equal(searchWorkflow(project, "episode", "赴约")[0].episode, 9);
  assert.equal(searchWorkflow(project, "episode", "999").length, 0);
});

test("shot numbers can be combined with an episode and search includes collapsed content", () => {
  const project = buildProject();
  for (const query of [
    "10-3",
    "１０－０３",
    "第10集 镜头03",
    "EP10 S03",
    "第10集 第3镜",
  ]) {
    const matches = searchWorkflow(project, "shot", query);
    assert.equal(matches.length, 1, query);
    assert.equal(matches[0].id, "episode-10-shot-3-board");
  }
  assert.equal(searchWorkflow(project, "shot", "3").length, 1);
  assert.equal(searchWorkflow(project, "shot", "01-02").length, 0);
  assert.equal(searchWorkflow(project, "shot", "伞骨藏印")[0].shot, 3);
  assert.equal(searchWorkflow(project, "shot", "左手保持握伞")[0].shot, 3);
});

test("search only returns current project/current text, not asset tasks or old versions", () => {
  const project = buildProject("another", "另一本", 2, 2);
  const before = structuredClone(project);
  assert.equal(searchWorkflow(project, "shot", "").length, 0);
  assert.equal(searchWorkflow(project, "shot", "10-3").length, 0);
  assert.deepEqual(project, before);
});
