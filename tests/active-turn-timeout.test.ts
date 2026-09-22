import test from "node:test";
import assert from "node:assert/strict";
import { ActiveTurnTimeout } from "../src/server/ai/active-turn-timeout";

function clock() {
  let time = 0;
  const scheduled = new Set<{ due: number; callback: () => void }>();
  return {
    now: () => time,
    schedule(callback: () => void, milliseconds: number) {
      const entry = { due: time + milliseconds, callback };
      scheduled.add(entry);
      return () => { scheduled.delete(entry); };
    },
    advance(milliseconds: number) {
      const end = time + milliseconds;
      for (;;) {
        const next = [...scheduled].sort((a, b) => a.due - b.due)[0];
        if (!next || next.due > end) break;
        time = next.due;
        scheduled.delete(next);
        next.callback();
      }
      time = end;
    },
  };
}

test("coordinator can await a long production/review pipeline without spending its model timeout", () => {
  const time = clock();
  let expired = 0;
  const deadline = new ActiveTurnTimeout(15 * 60_000, () => expired++, time);
  time.advance(2 * 60_000);
  const release = deadline.hold();
  time.advance(25 * 60_000);
  assert.equal(expired, 0);
  release();
  time.advance(13 * 60_000 - 1);
  assert.equal(expired, 0);
  time.advance(1);
  assert.equal(expired, 1);
});

test("overlapping tools wait for all results and repeated tools do not reset the model budget", () => {
  const time = clock();
  let expired = 0;
  const deadline = new ActiveTurnTimeout(100, () => expired++, time);
  time.advance(40);
  const first = deadline.hold(), second = deadline.hold();
  time.advance(500);
  first(); first();
  time.advance(500);
  assert.equal(expired, 0);
  second();
  time.advance(20);
  const third = deadline.hold();
  time.advance(500);
  third();
  time.advance(39);
  assert.equal(expired, 0);
  time.advance(1);
  assert.equal(expired, 1);
});

test("finished or disconnected turns cannot be timed out by late host-tool completion", () => {
  const time = clock();
  let expired = 0;
  const deadline = new ActiveTurnTimeout(100, () => expired++, time);
  const release = deadline.hold();
  deadline.stop();
  release();
  deadline.hold()();
  time.advance(1000);
  assert.equal(expired, 0);
});
