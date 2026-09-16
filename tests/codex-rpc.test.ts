import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { CodexRpc } from "../src/server/codex-rpc";
test("stdio bridge isolates API credentials, redacts upstream errors, bounds waits and rejects disconnects", async () => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "never-use-this";
  const rpc = new CodexRpc(process.cwd(), process.execPath, [
    path.resolve("tests/fixtures/codex-rpc.mjs"),
  ]);
  if (old === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = old;
  try {
    await rpc.initialize();
    const [a, b] = await Promise.all([rpc.request("a"), rpc.request("b")]);
    assert.equal(a.method, "a");
    assert.equal(b.method, "b");
    assert.equal(a.hasApiKey, false);
    await assert.rejects(
      rpc.request("error"),
      (error) =>
        error instanceof Error &&
        !error.message.includes("secret-token") &&
        error.message.includes("-123"),
    );
    await assert.rejects(rpc.request("timeout", {}, 20), /等待超时/);
    await assert.rejects(rpc.request("exit"), /中断/);
  } finally {
    rpc.close();
  }
});
