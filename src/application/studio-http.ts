export class StudioConnectionError extends Error {
  constructor() {
    super("网络连接暂时中断，请稍后重试");
  }
}

/** Only callers with an idempotency key may retry writes after an uncertain result. */
export async function studioJson<T = any>(
  url: string,
  init?: RequestInit,
  options: { retryUncertain?: boolean; fetcher?: typeof fetch } = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.retryUncertain ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    let data: any;
    try {
      response = await fetcher(url, init);
    } catch {
      if (attempt + 1 < attempts) continue;
      throw new StudioConnectionError();
    }
    if ([502, 503, 504].includes(response.status)) {
      if (attempt + 1 < attempts) continue;
      throw new StudioConnectionError();
    }
    if (response.status === 401)
      throw new Error("登录已失效，请重新登录后再试");
    try {
      data = await response.json();
    } catch {
      // The server may have saved the message before its response was interrupted.
      if (response.ok && attempt + 1 < attempts) continue;
      if (response.ok) throw new StudioConnectionError();
      throw new Error(`请求未完成（${response.status}），请稍后重试`);
    }
    if (!response.ok)
      throw new Error(typeof data?.error === "string" ? data.error : `请求未完成（${response.status}）`);
    return data as T;
  }
  throw new StudioConnectionError();
}
