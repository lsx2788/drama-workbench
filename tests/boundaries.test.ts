import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createMemoryRepository } from "../src/mocks/memory-repository";
import { initialState, buildProject } from "../src/mocks/fixtures";
import { changeTask, missingInputs, shotId } from "../src/domain/index";

test("task audit stays independent from human and AI discussion", () => {
  const before = buildProject();
  const after = changeTask(before, shotId(10, 3, "video"), {
    type: "toggle-executor",
  });
  assert.deepEqual(after.messages, before.messages);
  assert.equal(after.events.at(-1)?.action, "toggle-executor");
  assert.equal(before.events.length, 0);
});

test("a missing dependency cannot be treated as an approved input", () => {
  const project = buildProject();
  const task = project.tasks[shotId(1, 1)];
  task.dependencies = ["nonexistent"];
  assert.throws(() => missingInputs(project, task), /前置任务不存在/);
});

test("repository owns its snapshot and keeps files when only state changes", async () => {
  const repository = createMemoryRepository();
  assert.equal(await repository.load(), null);
  const state = initialState();
  const file = new File(["原文内容"], "故事.txt", { type: "text/plain" });
  await repository.save(state, { key: "qinghe/sources", files: [file] });
  state.projects[0].name = "outside mutation";
  let loaded = (await repository.load())!;
  assert.notEqual(loaded.state.projects[0].name, "outside mutation");
  loaded.state.projects[0].name = "saved change";
  await repository.save(loaded.state);
  loaded.files["qinghe/sources"].pop();
  loaded = (await repository.load())!;
  assert.equal(loaded.state.projects[0].name, "saved change");
  assert.equal(await loaded.files["qinghe/sources"][0].text(), "原文内容");
  assert.equal(await createMemoryRepository().load(), null);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : /\.[cm]?[tj]sx?$/.test(file)
        ? [file]
        : [];
  });
}

test("standalone layers cannot silently regain legacy/database dependencies", () => {
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /drama-workbench|\/api\/v1\//, file);
    if (file.includes(`${path.sep}domain${path.sep}`)) {
      assert.doesNotMatch(text, /from ["'](?:react|next|node:|@\/)/, file);
      assert.doesNotMatch(text, /indexedDB|localStorage|fetch\(/, file);
    }
    if (file.includes(`${path.sep}application${path.sep}`)) {
      assert.doesNotMatch(
        text,
        /from ["']@\/(?:infrastructure|mocks|features|workspace)/,
        file,
      );
    }
  }
});
