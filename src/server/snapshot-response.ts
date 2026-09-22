import { createHash } from "node:crypto";

/** Private validators avoid retransmitting unchanged state; no shared cache. */
export function snapshotResponse(snapshot: unknown, request?: Request) {
  const body = JSON.stringify(snapshot);
  const tag = '"' + createHash("sha256").update(body).digest("hex") + '"';
  const headers = {
    "Cache-Control": "private, no-cache",
    ETag: tag,
    Vary: "Authorization, Cookie",
  };
  const match = request?.headers
    .get("if-none-match")
    ?.split(",")
    .some((value) => value.trim().replace(/^W\//, "") === tag);
  return match
    ? new Response(null, { status: 304, headers })
    : new Response(body, {
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
}
