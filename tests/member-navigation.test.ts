import test from "node:test";
import assert from "node:assert/strict";
import { emptyProject } from "../src/domain/structure";
import {
  stageTasks,
  memberStages,
  taskActivityGroups,
} from "../src/features/discussion/member-groups";
import {
  groupSkills,
  skillSectionLabel,
} from "../src/features/discussion/skill-groups";
import type { SkillEntry } from "../src/domain/skills";

test("member stages pair roles with real nodes and exclude placeholders and retired tasks", () => {
  const p = emptyProject(),
    seed = p.tasks.source;
  p.tasks = {
    a: { ...seed, id: "a", kind: "assets", title: "角色", episode: 2 },
    b: { ...seed, id: "b", kind: "board", title: "分镜", episode: 1 },
    c: { ...seed, id: "c", kind: "assets", title: "未做", placeholder: true },
    d: {
      ...seed,
      id: "d",
      kind: "assets",
      title: "已清理",
      retirement: { actor: "coordinator", reason: "取消", time: "now" },
    },
  };
  assert.deepEqual(
    stageTasks(p, ["assets"]).map((t) => t.id),
    ["a"],
  );
  assert.deepEqual(
    stageTasks(p, ["storyboard", "board"]).map((t) => t.id),
    ["b"],
  );
  assert.equal(new Set(memberStages.flatMap((s) => s.kinds)).size, 7);
});
test("status separates active and waiting, respects latest work and hides accepted or retired assets", () => {
  const p = emptyProject(),
    seed = p.tasks.source;
  p.tasks = {
    a: { ...seed, id: "a" },
    b: { ...seed, id: "b", delivery: "approved" },
    c: {
      ...seed,
      id: "c",
      retirement: { actor: "coordinator", reason: "取消", time: "now" },
    },
    d: { ...seed, id: "d" },
  };
  p.messages = [
    ...[
      ["a", "working"],
      ["b", "failed"],
      ["c", "paused"],
      ["d", "reviewing"],
      ["a", "submitted"],
    ].map(([taskId, status], i) => ({
      id: String(i),
      sender: "AI",
      text: "",
      time: "now",
      taskId,
      execution: { status },
    })),
  ];
  const groups = taskActivityGroups(p);
  assert.deepEqual(
    groups.map((g) => [g.title, g.rows.map((r) => r.taskId)]),
    [
      ["正在执行", ["d"]],
      ["等待处理", ["a"]],
    ],
  );
});
test("skill grouping preserves each skill once, supports new unknown skills and finds methods", () => {
  const item = (id: string, title = id): SkillEntry => ({
    id,
    title,
    description: "方法",
    version: "1",
    customRevision: 0,
    enabled: true,
    references: [],
  });
  const items = [
    item("episode-planning", "分集容量"),
    item("character-reference", "人物规范"),
    item("new-skill", "新方法"),
  ];
  assert.deepEqual(
    groupSkills(items)
      .flatMap((g) => g.items)
      .map((i) => i.id),
    items.map((i) => i.id),
  );
  assert.deepEqual(
    groupSkills(items, "分集")
      .flatMap((g) => g.items)
      .map((i) => i.id),
    ["episode-planning"],
  );
  assert.equal(
    skillSectionLabel("references/timing-handoff.md", "# 时长与交接\n正文"),
    "时长与交接",
  );
});
