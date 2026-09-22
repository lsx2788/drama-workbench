import test from "node:test";
import assert from "node:assert/strict";
import { buildProject } from "../src/mocks/fixtures";
import { changeTask } from "../src/domain/commands";
import { manualHandoff, manualReadyTasks } from "../src/domain/manual-handoff";
import { draftMatches } from "../src/features/tasks/editor-state";
import type { MediaFile } from "../src/domain";

test("episode assembly requires every accepted clip; storyboard text is not mistaken for a missing video", () => {
  const project = buildProject("assembly", "合成", 1, 2);
  const assembly = project.tasks["episode-1-assembly"];
  const board = {
    ...project.tasks["episode-1"],
    id: "episode-1-storyboard",
    kind: "storyboard" as const,
    structure: {
      kind: "shots" as const,
      items: [],
      representative: 1,
      reason: "测试",
      complete: true,
    },
  };
  project.tasks[board.id] = board;
  assembly.dependencies.push(board.id);
  const files: Record<string, MediaFile[]> = {};
  for (const task of Object.values(project.tasks).filter(
    (t) => t.kind === "video",
  )) {
    task.delivery = "approved";
    files[`${project.id}/${task.id}`] = [
      { name: "镜头.mp4", url: "/api/files/clip", type: "video/mp4", size: 10 },
    ];
  }
  const handoff = manualHandoff(project, assembly, files);
  assert.equal(handoff.ready, true);
  assert.equal(handoff.primary.length, 2);
  assert.equal(
    handoff.inputs.some((input) => input.task.kind === "frames"),
    false,
  );
  delete files[`${project.id}/episode-1-shot-2-video`];
  assert.equal(manualHandoff(project, assembly, files).ready, false);
});

test("handoff keeps approved corrections and same-version acceptance, excludes stale approvals and trash", () => {
  const project = buildProject("handoff", "交接", 1, 2);
  const frame = project.tasks["episode-1-shot-1-frames"];
  frame.delivery = "approved";
  frame.revision = 2;
  project.tasks["episode-1-shot-1-assets"].text = "正式修订：无簪、单人";
  project.tasks["episode-1-shot-1-assets"].delivery = "approved";
  project.events = [1, 2].map((revision) => ({
    id: String(revision),
    taskId: frame.id,
    action: "accept",
    revision,
    text: revision === 2 ? "仅本镜头允许低分辨率试片" : "过时验收",
    time: "2026-09-20",
  }));
  const file: MediaFile = {
    id: "test",
    name: "首帧.png",
    url: "/api/files/test",
    type: "image/png",
    size: 10,
    width: 941,
    height: 1672,
  };
  const files = {
    [`${project.id}/${frame.id}`]: [
      file,
      { ...file, id: "trash", name: "已回收.png", trashed: true },
    ],
  };
  const video = project.tasks["episode-1-shot-1-video"];
  const handoff = manualHandoff(project, video, files);
  assert.equal(handoff.ready, true);
  assert.match(handoff.text, /正式修订：无簪、单人/);
  assert.match(handoff.text, /仅本镜头允许低分辨率试片/);
  assert.match(handoff.text, /941×1672/);
  assert.doesNotMatch(handoff.text, /过时验收|已回收.png/);
  assert.equal(manualHandoff(project, video, {}).ready, false);
  assert.deepEqual(
    manualReadyTasks(project).map((t) => t.id),
    [video.id],
  );
  video.enabled = false;
  assert.equal(manualReadyTasks(project).length, 0);
});

test("manual upload becomes a draft without requiring a separate text save; acceptance still needs files and inputs", () => {
  let project = buildProject("handoff", "交接", 1, 2);
  const id = "episode-1-shot-1-video";
  project = changeTask(project, id, { type: "attach" });
  assert.equal(project.tasks[id].delivery, "draft");
  assert.match(project.tasks[id].text, /待核对/);
  assert.throws(
    () => changeTask(project, id, { type: "accept", mediaPresent: true }),
    /前置/,
  );
  project.tasks["episode-1-shot-1-frames"].delivery = "approved";
  assert.throws(
    () => changeTask(project, id, { type: "accept", mediaPresent: false }),
    /视频/,
  );
  project = changeTask(project, id, { type: "accept", mediaPresent: true });
  assert.equal(project.tasks[id].delivery, "approved");
});

test("editor compares against loaded baseline; remote changes do not make untouched input dirty", () => {
  const task = buildProject("editing", "编辑", 1, 1).tasks[
    "episode-1-shot-1-assets"
  ];
  const draft = {
    text: task.text,
    reason: task.reuseReason,
    assetIds: task.assetIds,
    assetName: task.assetName ?? "",
    assetCategory: task.assetCategory ?? "人物",
  };
  const remote = { ...task, revision: task.revision + 1, text: "后台新产出" };
  assert.equal(draftMatches(draft, task), true);
  assert.equal(draftMatches(draft, remote), false);
  assert.equal(draftMatches({ ...draft, text: "用户未保存内容" }, task), false);
  assert.equal(
    draftMatches({ ...draft, assetIds: ["different"] }, task),
    false,
  );
});
