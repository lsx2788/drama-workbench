import test from "node:test";
import assert from "node:assert/strict";
import {
  createSnapshotSync,
  pollDelay,
} from "../src/application/snapshot-sync";
import { snapshotResponse } from "../src/server/snapshot-response";
const data = (v: number) => ({ state: { projects: [], v }, files: {} });
test("private snapshot validators return no body for unchanged state and change with content", async () => {
  const first = snapshotResponse(data(1)),
    tag = first.headers.get("etag")!;
  const unchanged = snapshotResponse(
    data(1),
    new Request("http://local", { headers: { "if-none-match": tag } }),
  );
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  assert.match(first.headers.get("cache-control")!, /private/);
  assert.equal(
    snapshotResponse(
      data(2),
      new Request("http://local", { headers: { "if-none-match": tag } }),
    ).status,
    200,
  );
});
test("slow polling shares one request and forced refresh after writes keeps initial data on 304", async () => {
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sync = createSnapshotSync(async (_url, init) => {
    calls++;
    if (calls === 1) {
      await gate;
      return snapshotResponse(data(1));
    }
    assert.ok(new Headers(init?.headers).get("if-none-match"));
    return new Response(null, { status: 304 });
  });
  const first = sync.load(),
    second = sync.load(),
    forced = sync.load(true);
  assert.equal(calls, 1);
  release();
  const [a, b, c] = await Promise.all([first, second, forced]);
  assert.equal(calls, 2);
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(c.state.v, 1);
});
test("failed requests retain validator and next successful changed snapshot replaces cache", async () => {
  let count = 0;
  const sync = createSnapshotSync(async () => {
    count++;
    if (count === 2) throw new TypeError("offline");
    return snapshotResponse(data(count));
  });
  await sync.load();
  await assert.rejects(sync.load(), /网络连接/);
  assert.equal((await sync.load()).state.v, 3);
  assert.equal(pollDelay(0, true), 2500);
  assert.equal(pollDelay(0, false), 8000);
  assert.equal(pollDelay(5, true), 30000);
});
