import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedAssets,
  changeTask,
  epId,
  missingInputs,
  shotId,
  taskStatus,
} from "../src/domain/index";
import { buildProject } from "../src/mocks/fixtures";

test("node status follows the latest execution without reviving accepted or paused work", () => {
  const p = buildProject();
  const task = p.tasks[shotId(1, 1)];
  task.delivery = "empty";
  p.messages = [
    {
      id: "working",
      sender: "分镜 AI",
      taskId: task.id,
      text: "任务已交接",
      time: "2026-09-21T09:00:00Z",
      execution: { status: "working" },
    },
  ];
  assert.equal(taskStatus(p, task).label, "工作中");
  task.delivery = "draft";
  p.messages.push({
    ...p.messages[0],
    id: "reviewing",
    execution: { status: "reviewing" },
  });
  assert.equal(taskStatus(p, task).label, "节点审核中");
  p.messages.push({
    ...p.messages[0],
    id: "another-task",
    taskId: shotId(1, 2),
    execution: { status: "failed" },
  });
  assert.equal(taskStatus(p, task).label, "节点审核中");
  task.delivery = "approved";
  assert.equal(taskStatus(p, task).label, "已验收");
  task.enabled = false;
  assert.equal(taskStatus(p, task).label, "已暂停");
});

test("prototype models variable script → episodes → shots → per-episode video without cross-episode prerequisites", () => {
  const p = buildProject("fixture", "独立故事", 3, 4);
  assert.equal(p.episodes.length, 3);
  assert.equal(
    Object.values(p.tasks).filter((t) => t.kind === "board").length,
    12,
  );
  assert.deepEqual(p.tasks[shotId(2, 4)].dependencies, [epId(2)]);
  assert.deepEqual(
    p.tasks["episode-2-assembly"].dependencies,
    [1, 2, 3, 4].map((s) => shotId(2, s, "video")),
  );
  assert.equal(
    Object.values(p.tasks).some((t) =>
      t.dependencies.some((id) => !p.tasks[id]),
    ),
    false,
  );
});

test("pausing a representative video does not block other shots or other episodes", () => {
  let p = buildProject();
  p = changeTask(p, shotId(10, 3, "video"), { type: "toggle-executor" });
  assert.equal(taskStatus(p, p.tasks[shotId(10, 3, "video")]).label, "已暂停");
  assert.equal(missingInputs(p, p.tasks[shotId(10, 4)]).length, 0);
  assert.equal(missingInputs(p, p.tasks[shotId(1, 1)]).length, 0);
  p = changeTask(p, shotId(1, 1), { type: "save", text: "另一集的分镜" });
  assert.equal(p.tasks[shotId(1, 1)].delivery, "draft");
});

test("disabled unfinished episode blocks its own shot production, not sibling episodes", () => {
  let p = buildProject();
  p.tasks[epId(10)].delivery = "empty";
  p = changeTask(p, epId(10), { type: "toggle-executor" });
  assert.equal(missingInputs(p, p.tasks[shotId(10, 1)])[0].id, epId(10));
  assert.throws(
    () => changeTask(p, shotId(10, 1), { type: "save", text: "不应开始" }),
    /前置产出/,
  );
  assert.equal(missingInputs(p, p.tasks[shotId(2, 1)]).length, 0);
  assert.equal(p.tasks[shotId(10, 1)].enabled, true);
});

test("pausing an executor retains previously accepted output for dependent tasks", () => {
  const p = changeTask(buildProject(), epId(10), { type: "toggle-executor" });
  assert.equal(p.tasks[epId(10)].delivery, "approved");
  assert.equal(missingInputs(p, p.tasks[shotId(10, 1)]).length, 0);
});

test("disabled review is a recorded skip, never approval; coordinator acceptance still required", () => {
  let p = buildProject();
  const id = shotId(1, 1);
  p = changeTask(p, id, { type: "save", text: "镜头草稿" });
  assert.throws(() => changeTask(p, id, { type: "accept" }), /内部审核/);
  p = changeTask(p, id, { type: "toggle-review" });
  assert.equal(p.tasks[id].delivery, "draft");
  assert.match(p.events.at(-1)!.text, /已跳过/);
  assert.equal(missingInputs(p, p.tasks[shotId(1, 1, "assets")]).length, 1);
  p = changeTask(p, id, { type: "accept" });
  assert.equal(p.tasks[id].delivery, "approved");
  assert.equal(missingInputs(p, p.tasks[shotId(1, 1, "assets")]).length, 0);
});

test("asset reuse queries exclude candidates and reviewers require a reuse explanation", () => {
  let p = buildProject();
  assert.equal(approvedAssets(p, "中年").length, 0);
  assert.equal(approvedAssets(p, "沈青禾").length, 1);
  const id = shotId(10, 3, "assets");
  assert.throws(
    () =>
      changeTask(p, id, {
        type: "save",
        text: "资产清单",
        assetIds: ["CHAR-003"],
      }),
    /审核通过/,
  );
  p = changeTask(p, id, {
    type: "save",
    text: "资产清单",
    assetIds: ["CHAR-001"],
  });
  assert.throws(() => changeTask(p, id, { type: "review" }), /查询结果/);
  p = changeTask(p, id, {
    type: "save",
    text: "资产清单",
    reuseReason:
      "已查询沈青禾：24 岁设定适用，引用 CHAR-001 v1；暂无符合要求的角色图，需要制作图片。",
  });
  p = changeTask(p, id, { type: "review" });
  p = changeTask(p, id, { type: "accept" });
  assert.equal(p.tasks[id].delivery, "approved");
});

test("returning and resubmitting retains versions and requires review again", () => {
  let p = buildProject();
  const id = shotId(1, 1);
  p = changeTask(p, id, { type: "save", text: "版本一" });
  p = changeTask(p, id, { type: "review" });
  assert.throws(
    () => changeTask(p, id, { type: "return", reason: " " }),
    /退回原因/,
  );
  p = changeTask(p, id, { type: "return", reason: "动作过多" });
  p = changeTask(p, id, { type: "save", text: "只保留一个动作" });
  assert.equal(p.tasks[id].history[0].text, "版本一");
  assert.equal(p.tasks[id].revision, 2);
  assert.equal(p.tasks[id].delivery, "draft");
  assert.throws(() => changeTask(p, id, { type: "accept" }), /内部审核/);
});

test("frame instructions cannot masquerade as completed images and approved frame assets keep lineage", () => {
  let p = buildProject();
  const id = shotId(10, 3, "frames"),
    assets = shotId(10, 3, "assets");
  p.tasks[assets].delivery = "approved";
  p.tasks[assets].assetIds = ["CHAR-001", "PROP-001"];
  p = changeTask(p, id, { type: "save", text: "首帧：握伞。关键动作：取印。" });
  p = changeTask(p, id, { type: "review" });
  assert.throws(() => changeTask(p, id, { type: "accept" }), /只有制作说明/);
  p = changeTask(p, id, { type: "accept", imagesPresent: true });
  const frame = p.assets.find((a) => a.taskId === id)!;
  assert.deepEqual(frame.sourceIds, ["CHAR-001", "PROP-001"]);
  assert.equal(frame.status, "approved");
  assert.throws(
    () => changeTask(p, id, { type: "save", text: "偷偷换基准" }),
    /已验收/,
  );
});

test("manual drafts can be stored early but a partial episode cannot be accepted", () => {
  let p = buildProject();
  const id = "episode-10-assembly";
  p = changeTask(p, id, { type: "save", text: "已剪辑前三个镜头，剩余待补" });
  assert.equal(p.tasks[id].delivery, "draft");
  assert.throws(
    () => changeTask(p, id, { type: "accept", mediaPresent: true }),
    /前置产出/,
  );
  p.tasks[id].dependencies.forEach(
    (dep) => (p.tasks[dep].delivery = "approved"),
  );
  assert.throws(
    () => changeTask(p, id, { type: "accept" }),
    /添加人工制作的视频/,
  );
  p = changeTask(p, id, { type: "accept", mediaPresent: true });
  assert.equal(p.tasks[id].delivery, "approved");
});

test("adding files invalidates previous internal review and accepted files stay immutable", () => {
  let p = buildProject();
  const id = shotId(10, 3, "frames");
  p.tasks[shotId(10, 3, "assets")].delivery = "approved";
  p = changeTask(p, id, { type: "save", text: "画面制作说明" });
  p = changeTask(p, id, { type: "review" });
  p = changeTask(p, id, { type: "attach" });
  assert.equal(p.tasks[id].delivery, "draft");
  assert.throws(
    () => changeTask(p, id, { type: "accept", imagesPresent: true }),
    /内部审核/,
  );
  p = changeTask(p, id, { type: "review" });
  p = changeTask(p, id, { type: "accept", imagesPresent: true });
  assert.throws(() => changeTask(p, id, { type: "attach" }), /不能直接追加/);
});

test("new image assets need named metadata and are published only on coordinator acceptance", () => {
  let p = buildProject();
  const id = shotId(10, 3, "assets");
  p = changeTask(p, id, {
    type: "save",
    text: "青禾24岁人物图",
    reuseReason: "只查到人物设定文本，没有对应图像，需要制作",
  });
  p = changeTask(p, id, { type: "review" });
  assert.throws(
    () => changeTask(p, id, { type: "accept", imagesPresent: true }),
    /名称和分类/,
  );
  assert.equal(
    p.assets.some((a) => a.taskId === id),
    false,
  );
  p = changeTask(p, id, {
    type: "save",
    text: "青禾24岁人物图",
    assetName: "青禾24岁定妆",
    assetCategory: "人物",
    assetIds: ["CHAR-001"],
  });
  p = changeTask(p, id, { type: "review" });
  p = changeTask(p, id, { type: "accept", imagesPresent: true });
  assert.equal(approvedAssets(p, "定妆")[0].taskId, id);
  assert.deepEqual(approvedAssets(p, "定妆")[0].sourceIds, ["CHAR-001"]);
});
