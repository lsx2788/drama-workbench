import test from "node:test";
import assert from "node:assert/strict";
import {
  taskOutputState,
  assetOutputState,
  approvedBasisAssets,
} from "../src/domain/output-status";
import { buildProject } from "../src/mocks/fixtures";
import type { Asset } from "../src/domain";

test("paused rejected output leaves discussion without creating a false acceptance; resuming restores discussion", () => {
  const project = buildProject("status", "测试", 1, 1);
  const task = project.tasks["episode-1-shot-1-assets"];
  task.delivery = "returned";
  task.enabled = false;
  task.text = "旧方案";
  const asset: Asset = {
    id: "old",
    name: "旧图",
    category: "人物",
    status: "draft",
    description: "旧方案",
    version: 2,
    sourceIds: [],
    taskId: task.id,
  };
  const before = JSON.stringify(task);
  assert.equal(taskOutputState(task), "paused");
  assert.equal(assetOutputState(asset, project.tasks), "paused");
  assert.equal(JSON.stringify(task), before);
  assert.equal(asset.status, "draft");
  task.enabled = true;
  assert.equal(taskOutputState(task), "draft");
  assert.equal(assetOutputState(asset, project.tasks), "draft");
});

test("accepted assets remain accepted if their executor pauses; unknown legacy candidates do not become approved", () => {
  const task = buildProject("status", "测试", 1, 1).tasks[
    "episode-1-shot-1-assets"
  ];
  task.delivery = "approved";
  task.enabled = false;
  assert.equal(taskOutputState(task), "approved");
  const asset: Asset = {
    id: "image",
    name: "图片",
    category: "人物",
    status: "approved",
    description: "",
    version: 1,
    sourceIds: [],
    taskId: task.id,
  };
  assert.equal(assetOutputState(asset, { [task.id]: task }), "approved");
  assert.equal(assetOutputState({ ...asset, status: "draft" }, {}), "draft");
  assert.deepEqual(
    approvedBasisAssets([
      asset,
      { ...asset, id: "candidate", status: "draft" },
      { ...asset, id: "frame", category: "镜头画面" },
    ]),
    [asset],
  );
});
