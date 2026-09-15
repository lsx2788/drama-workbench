import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createGateway } from "../scripts/remote-gateway.mjs";

test("remote gateway protects every path and validates origins before forwarding writes", async () => {
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        path: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const targetPort = (upstream.address() as AddressInfo).port;
  const allowedHosts = new Set<string>();
  const gateway = createGateway({
    username: "viewer",
    password: "test-long-password",
    targetPort,
    allowedHosts,
    apiToken: undefined,
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const base = `http://${host}`;
  allowedHosts.add(host);
  const authorization = `Basic ${Buffer.from("viewer:test-long-password").toString("base64")}`;
  try {
    for (const path of [
      "/",
      "/api/v1/projects",
      "/api/v1/projects/p/files/f",
      "/_next/static/test.js",
    ]) {
      const denied = await fetch(base + path);
      assert.equal(denied.status, 401);
      assert.match(denied.headers.get("www-authenticate")!, /Basic/);
      await denied.text();
    }
    const wrong = await fetch(base, {
      headers: { authorization: "Basic invalid" },
    });
    assert.equal(wrong.status, 401);
    await wrong.text();
    const denied = await fetch(base + "/api/v1/projects", {
      method: "POST",
      headers: { authorization, origin: "https://evil.example" },
      body: "{}",
    });
    assert.equal(denied.status, 403);
    await denied.text();
    const response = await fetch(base + "/api/v1/projects?archived=false", {
      method: "POST",
      headers: {
        authorization,
        origin: base,
        "x-forwarded-host": "evil.example",
        "cf-connecting-ip": "fake",
        "Content-Type": "application/json",
      },
      body: '{"message":"手机提交"}',
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result = await response.json();
    assert.equal(result.path, "/api/v1/projects?archived=false");
    assert.equal(result.body, '{"message":"手机提交"}');
    assert.equal(result.headers.origin, `http://127.0.0.1:${targetPort}`);
    assert.equal(result.headers.host, `127.0.0.1:${targetPort}`);
    assert.equal(result.headers.authorization, undefined);
    assert.equal(result.headers["x-forwarded-host"], undefined);
    assert.equal(result.headers["cf-connecting-ip"], undefined);
    allowedHosts.delete(host);
    const badHost = await fetch(base, { headers: { authorization } });
    assert.equal(badHost.status, 403);
    await badHost.text();
  } finally {
    await Promise.all(
      [gateway, upstream].map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  }
});
