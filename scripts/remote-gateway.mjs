import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
function cleanHeaders(headers) {
  const result = { ...headers };
  const connection = String(headers.connection ?? "").split(",");
  for (const key of [...hopHeaders, ...connection])
    delete result[key.trim().toLowerCase()];
  return result;
}

/** A password gate for a fixed loopback app, never a general-purpose proxy. */
export function createGateway({
  username,
  password,
  targetPort = 3000,
  allowedHosts,
  apiToken,
}) {
  if (!username || !password) throw new Error("Remote credentials required");
  const expected = digest(
    `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  );
  return http.createServer({ requestTimeout: 120_000 }, (req, res) => {
    const reply = (status, message) => {
      res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(message);
    };
    if (!timingSafeEqual(digest(req.headers.authorization ?? ""), expected)) {
      res.setHeader(
        "WWW-Authenticate",
        'Basic realm="Drama Workbench", charset="UTF-8"',
      );
      return reply(401, "请输入远程访问用户名和密码。");
    }
    const host = req.headers.host ?? "";
    if (!allowedHosts.has(host)) return reply(403, "访问地址不匹配");
    if (!req.url?.startsWith("/") || req.url.startsWith("//"))
      return reply(400, "无效地址");
    const origin = req.headers.origin;
    const local = host.startsWith("127.0.0.1:");
    const externalOrigin = `${local ? "http" : "https"}://${host}`;
    if (origin && origin !== externalOrigin)
      return reply(403, "拒绝跨来源请求");
    if (
      !["GET", "HEAD"].includes(req.method ?? "") &&
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return reply(403, "拒绝跨来源写入");

    const headers = cleanHeaders(req.headers);
    for (const key of Object.keys(headers)) {
      if (
        key === "authorization" ||
        key === "forwarded" ||
        key.startsWith("x-forwarded-") ||
        key.startsWith("cf-")
      )
        delete headers[key];
    }
    headers.host = `127.0.0.1:${targetPort}`;
    // Only normalize an origin after checking the browser's public origin above.
    if (origin) headers.origin = `http://127.0.0.1:${targetPort}`;
    if (apiToken) headers.authorization = `Bearer ${apiToken}`;
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, {
          ...cleanHeaders(response.headers),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "same-origin",
        });
        response.on("error", () => res.destroy());
        response.pipe(res);
      },
    );
    upstream.setTimeout(120_000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) reply(502, "本机工作台暂时不可用");
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
}
