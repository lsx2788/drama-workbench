import test from "node:test";
import assert from "node:assert/strict";
import { studioJson, StudioConnectionError } from "../src/application/studio-http";

test("uncertain message delivery retries the same request and accepts existing receipt", async () => {
  const requests: RequestInit[] = [];
  const init = { method: "POST", body: JSON.stringify({ type: "message", requestId: "same-key", text: "继续" }) };
  const fetcher = (async (_url, request) => {
    requests.push(request!);
    if (requests.length === 1) throw new TypeError("Load failed");
    return Response.json({ id: "existing-run", created: false });
  }) as typeof fetch;
  const result = await studioJson("/api/studio", init, { fetcher, retryUncertain: true });
  assert.equal(result.created, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
});

test("uploads and actions never automatically repeat after connection loss", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw new TypeError("Load failed"); }) as typeof fetch;
  await assert.rejects(studioJson("/api/studio", { method: "POST" }, { fetcher }), StudioConnectionError);
  assert.equal(calls, 1);
});

test("business failures and expired login are not retried", async () => {
  for (const status of [401, 409]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return Response.json({ error: "总控正在处理上一条消息" }, { status }); }) as typeof fetch;
    await assert.rejects(studioJson("/api/studio", undefined, { fetcher, retryUncertain: true }), status === 401 ? /重新登录/ : /总控正在处理/);
    assert.equal(calls, 1);
  }
});

test("broken responses and temporary tunnel failures retry only once", async () => {
  for (const status of [200, 502]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response("incomplete response", { status }); }) as typeof fetch;
    await assert.rejects(studioJson("/api/studio", undefined, { fetcher, retryUncertain: true }), StudioConnectionError);
    assert.equal(calls, 2);
  }
});
