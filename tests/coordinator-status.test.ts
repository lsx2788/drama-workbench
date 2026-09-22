import test from "node:test";
import assert from "node:assert/strict";
import { coordinatorStatus } from "../src/features/discussion/coordinator-status";
import type { StudioProject } from "../src/domain";

test("coordinator activity stops pulsing when a turn waits for an answer or stops", () => {
  const p = {
    messages: [{ confirmation: { status: "pending" } }],
    run: { status: "running" },
  } as StudioProject;
  assert.equal(coordinatorStatus(p).state, "working");
  p.run!.status = "completed";
  assert.equal(coordinatorStatus(p).state, "waiting");
  p.run!.status = "failed";
  p.run!.error = "处理超时";
  assert.equal(coordinatorStatus(p).state, "paused");
  assert.equal(coordinatorStatus(p).detail, "处理超时");
  p.run!.status = "completed";
  p.messages = [];
  assert.equal(coordinatorStatus(p).state, "idle");
});
