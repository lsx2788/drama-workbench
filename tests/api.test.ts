import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleApi } from "../src/server/api";
import { getStore } from "../src/server/db";

test("HTTP adapter preserves scope, origin checks, uploads and errors", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-api-"));
  process.env.DATA_DIR = root;
  const originalToken = process.env.WORKBENCH_TOKEN;
  delete process.env.WORKBENCH_TOKEN;
  t.after(() => {
    getStore().close();
    rmSync(root, { recursive: true, force: true });
    if (originalToken === undefined) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = originalToken;
  });
  async function request(
    parts: string[],
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return handleApi(
      new Request(`http://localhost:3000/api/v1/${parts.join("/")}`, {
        method,
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          ...headers,
        },
        body:
          body instanceof FormData
            ? body
            : body === undefined
              ? undefined
              : JSON.stringify(body),
      }),
      parts,
    );
  }
  const made = await request(["projects"], "POST", { name: "接口验收" });
  assert.equal(made.status, 200);
  const envelope = await made.json();
  assert.equal(envelope.error, null);
  assert.ok(envelope.requestId);
  const base = ["projects", envelope.data.id];
  const starter = await (await request([...base, "workspace"])).json();
  assert.equal(starter.data.nodes.length, 1);
  assert.equal(starter.data.nodes[0].node_type, "coordinator");
  assert.equal(starter.data.overview.workflow.status, "active");
  assert.equal(starter.data.sections.length, 0);
  assert.equal(starter.data.sessions.length, 1);
  const denied = await request(
    ["projects"],
    "POST",
    { name: "跨站" },
    { origin: "https://unrelated.example" },
  );
  assert.equal(denied.status, 403);
  assert.equal((await request([...base, "assets?unknown=1"])).status, 404);
  const asset = (
    await (
      await request([...base, "assets"], "POST", {
        code: "001",
        name: "男主",
        kind: "character",
      })
    ).json()
  ).data;
  const version = (
    await (
      await request([...base, "assets", asset.id, "versions"], "POST", {})
    ).json()
  ).data;
  const form = new FormData();
  form.set(
    "file",
    new File(["real persisted content"], "reference.txt", {
      type: "text/plain",
    }),
  );
  const file = (
    await (
      await request([...base, "versions", version.id, "files"], "POST", form)
    ).json()
  ).data;
  const downloaded = await request([...base, "files", file.id]);
  assert.equal(await downloaded.text(), "real persisted content");
  assert.match(downloaded.headers.get("content-disposition")!, /^attachment/);
  assert.equal(
    (
      await request([...base, "versions", version.id, "review"], "POST", {
        decision: "approved",
        scope: "参考文档",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request([...base, "versions", version.id, "files"], "POST", form))
      .status,
    409,
  );
  assert.equal(
    (await request([...base, "versions", version.id, "lineage", "extra"]))
      .status,
    404,
  );
  process.env.WORKBENCH_TOKEN = "test-only-token";
  assert.equal((await request(["projects"])).status, 401);
  assert.equal(
    (
      await request(["projects"], "GET", undefined, {
        authorization: "Bearer test-only-token",
      })
    ).status,
    200,
  );
});
