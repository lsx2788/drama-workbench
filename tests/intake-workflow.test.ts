import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/db";
import { importStory, storyFile } from "../src/server/story-service";
import { startStoryDiscussion } from "../src/server/story-discussion";
import { workspace } from "../src/server/read-service";
import {
  activateWorkflow,
  createNode,
  updateNodeState,
} from "../src/server/project-service";

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-intake-"));
  const s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  return s;
}

function intake(s: Store) {
  const imported = importStory(s, {
    source: "text",
    text: "完整保留的故事原文",
    importKey: randomUUID(),
  });
  const p = String(imported.project.id);
  const storyId = String(imported.story.id);
  const discussion = startStoryDiscussion(s, p, storyId);
  const w = workspace(s, p);
  return { p, storyId, discussion, w, workflowId: String(w.workflows[0].id) };
}

test("intake and planning stay unpublished until explicit publication, preserving the conversation", (t) => {
  const s = setup(t);
  const { p, w, workflowId, discussion } = intake(s);
  assert.equal(w.overview.workflow, null);
  assert.equal(w.workflows[0].status, "draft");
  assert.equal(w.messages[0].id, discussion.messageId);
  const node = createNode(s, p, { workflowId, name: "故事拆解" })!;
  assert.equal(workspace(s, p).overview.workflow, null);
  assert.throws(
    () => updateNodeState(s, p, String(node.id), "active"),
    /已发布/,
  );
  activateWorkflow(s, p, workflowId);
  const published = workspace(s, p);
  assert.equal(published.overview.workflow?.id, workflowId);
  assert.deepEqual(published.messages, w.messages);
  assert.deepEqual(published.sessions, w.sessions);
  updateNodeState(s, p, String(node.id), "active");
});

test("upgrade hides legacy empty intake charts without losing source or chats, and preserves real production", (t) => {
  const s = setup(t);
  const old = intake(s);
  activateWorkflow(s, old.p, old.workflowId);
  const production = intake(s);
  createNode(s, production.p, {
    workflowId: production.workflowId,
    name: "已确认的制作步骤",
  });
  activateWorkflow(s, production.p, production.workflowId);
  s.run("DELETE FROM schema_migrations WHERE version=10");
  const reopened = new Store(s.root);
  try {
    const migrated = workspace(reopened, old.p);
    assert.equal(migrated.overview.workflow, null);
    assert.deepEqual(migrated.agents, old.w.agents);
    assert.deepEqual(migrated.sessions, old.w.sessions);
    assert.deepEqual(migrated.messages, old.w.messages);
    assert.deepEqual(
      storyFile(reopened, old.p, old.storyId).bytes,
      Buffer.from("完整保留的故事原文"),
    );
    assert.deepEqual(
      startStoryDiscussion(reopened, old.p, old.storyId),
      old.discussion,
    );
    assert.equal(
      workspace(reopened, production.p).overview.workflow?.id,
      production.workflowId,
    );
    createNode(reopened, old.p, {
      workflowId: old.workflowId,
      name: "讨论后确定的步骤",
    });
    activateWorkflow(reopened, old.p, old.workflowId);
  } finally {
    reopened.close();
  }
  const restarted = new Store(s.root);
  try {
    assert.equal(
      workspace(restarted, old.p).overview.workflow?.id,
      old.workflowId,
    );
  } finally {
    restarted.close();
  }
});
