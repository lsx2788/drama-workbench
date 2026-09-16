import { DomainError } from "./common";

export type AiItem = Record<string, unknown>;
export type AiResponse = {
  id: string;
  status: string;
  output: AiItem[];
  usage?: unknown;
};
export type ResponseProvider = (
  key: string,
  body: AiItem,
) => Promise<AiResponse>;

export function providerError(status: number) {
  const message =
    status === 401
      ? "OpenAI 密钥无效，请检查连接设置"
      : status === 403
        ? "OpenAI 拒绝访问，请检查账号、地区或模型权限"
        : status === 429
          ? "OpenAI 额度不足或请求过于频繁，请检查账户后再试"
          : status === 400 || status === 404
            ? "OpenAI 不接受当前模型、工具或文件，请检查模型名称及文件格式"
            : "OpenAI 服务暂时不可用，请稍后再试";
  return new DomainError("OPENAI_ERROR", message, 502);
}
// No automatic paid retries. Credentials and raw upstream errors never enter logs.
export const openaiResponse: ResponseProvider = async (key, body) => {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    throw new DomainError(
      "OPENAI_NETWORK",
      "连接 OpenAI 中断或超时，远端可能已执行；本次不会自动重发",
      502,
    );
  }
  if (!response.ok) throw providerError(response.status);
  const result = (await response.json()) as AiResponse;
  if (!result.id || !Array.isArray(result.output))
    throw new DomainError("OPENAI_OUTPUT", "OpenAI 返回格式无法识别", 502);
  return result;
};
export async function testOpenaiConnection(key: string, model: string) {
  let response: Response;
  try {
    response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new DomainError("OPENAI_NETWORK", "无法连接 OpenAI，请检查网络", 502);
  }
  if (!response.ok) throw providerError(response.status);
  return {
    reachable: true,
    message: "密钥及文字模型访问正常；图片权限以实际生成为准。",
  };
}
