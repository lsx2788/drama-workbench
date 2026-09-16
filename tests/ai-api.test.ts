import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { handleApi } from "../src/server/api";
import { getStore } from "../src/server/db";

test("HTTP chat integrates multipart attachments, real provider adapter, queue polling and persisted image responses without exposing credentials", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-ai-api-"));
  const oldEnv = {
    DATA_DIR: process.env.DATA_DIR,
    WORKBENCH_TOKEN: process.env.WORKBENCH_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.DATA_DIR = root;
  delete process.env.WORKBENCH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kE3sAAAAASUVORK5CYII=";
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://api.openai.com/v1/"));
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer http-test-key",
    );
    if (String(url).includes("/models/"))
      return Response.json({ id: "gpt-6-astra" });
    providerCalls++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    assert.equal(body.model, "gpt-6-astra");
    return Response.json({
      id: "resp_http",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "已生成渡口候选图。" }],
        },
        { type: "image_generation_call", id: "ig_http", result: png },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    getStore().close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  async function request(
    parts: string[],
    method = "GET",
    body?: unknown,
    origin = "http://localhost:3000",
  ) {
    return handleApi(
      new Request(`http://localhost:3000/api/v1/${parts.join("/")}`, {
        method,
        headers: {
          origin,
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      }),
      parts,
    );
  }
  const created = await (
    await request(["projects"], "POST", { name: "HTTP AI 验收" })
  ).json();
  const p = created.data.id;
  const w = (await (await request(["projects", p, "workspace"])).json()).data;
  const ss = w.sessions[0].id;
  const turnsPath = ["projects", p, "sessions", ss, "turns"];
  assert.equal(
    (
      await request(turnsPath, "POST", {
        requestKey: randomUUID(),
        content: "未配置",
      })
    ).status,
    409,
  );
  assert.equal(getStore().all("SELECT * FROM messages").length, 0);
  assert.equal(
    (
      await request(
        ["openai"],
        "PATCH",
        { apiKey: "http-test-key" },
        "https://unrelated.example",
      )
    ).status,
    403,
  );
  const saved = await (
    await request(["openai"], "PATCH", { apiKey: "http-test-key" })
  ).json();
  assert.ok(!JSON.stringify(saved).includes("http-test-key"));
  assert.equal((await request(["openai", "test"], "POST")).status, 200);
  const form = new FormData();
  form.set("source", "files");
  form.set("importKey", randomUUID());
  form.append("file", new File(["渡口与账本"], "notes.txt"));
  form.append("file", new File([Buffer.from(png, "base64")], "ref.png"));
  const uploaded = await (
    await request(["projects", p, "stories"], "POST", form)
  ).json();
  assert.equal(uploaded.data.stories.length, 2);
  const send = {
    requestKey: randomUUID(),
    content: "画一张渡口图",
    storyIds: uploaded.data.stories.map((r: { id: string }) => r.id),
  };
  const queued = await (await request(turnsPath, "POST", send)).json();
  const again = await (await request(turnsPath, "POST", send)).json();
  assert.equal(again.data.id, queued.data.id);
  for (let i = 0; i < 50; i++) {
    if (
      getStore().one("SELECT status FROM ai_turns WHERE id=?", queued.data.id)
        ?.status === "completed"
    )
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const states = await (await request(turnsPath)).json();
  assert.equal(states.data[0].status, "completed");
  assert.equal(providerCalls, 1);
  const updated = (await (await request(["projects", p, "workspace"])).json())
    .data;
  assert.equal(updated.messages[0].attachments.length, 2);
  assert.equal(updated.messages[1].images.length, 1);
  const image = updated.messages[1].images[0];
  const media = await request(["projects", p, "files", image.id]);
  assert.equal(media.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await media.arrayBuffer()).toString("base64"), png);
  const detail = await (
    await request(["projects", p, "ai-turns", queued.data.id])
  ).json();
  assert.ok(!JSON.stringify(detail).includes("http-test-key"));
  assert.equal(detail.data.calls[0].response_id, "resp_http");
});
