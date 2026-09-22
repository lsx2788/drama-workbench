import { studioJson } from "./studio-http";

/** One reader per workspace: requests are serialized and validators remain in memory. */
export function createSnapshotSync(fetcher: typeof fetch = fetch) {
  let tag: string | null = null;
  let cached: any = null;
  let pending: Promise<any | null> | null = null;
  async function load(force = false): Promise<any | null> {
    if (pending) {
      if (!force) return pending;
      try {
        await pending;
      } catch {
        /* A write still needs a fresh read. */
      }
      return load(false);
    }
    const run = (async () => {
      let nextTag: string | null = null;
      const data = await studioJson(
        "/api/studio",
        {
          cache: "no-store",
          headers: tag ? { "If-None-Match": tag } : undefined,
          signal: AbortSignal.timeout(20000),
        },
        {
          fetcher: async (input, init) => {
            const response = await fetcher(input, init);
            if (response.status === 304 && tag) return Response.json(null);
            nextTag = response.ok ? response.headers.get("etag") : null;
            return response;
          },
        },
      );
      if (data !== null) {
        if (!data?.state || !Array.isArray(data.state.projects) || !data.files)
          throw new Error("同步数据不完整，请重试");
        tag = nextTag;
        cached = data;
      }
      return cached;
    })();
    pending = run;
    try {
      return await run;
    } finally {
      if (pending === run) pending = null;
    }
  }
  return { load };
}
export const pollDelay = (failures: number, working: boolean) =>
  failures
    ? Math.min(30000, 2500 * 2 ** Math.min(failures, 4))
    : working
      ? 2500
      : 8000;
