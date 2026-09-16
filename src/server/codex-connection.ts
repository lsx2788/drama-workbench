import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store } from "./db";
import { assert, DomainError, id } from "./common";
import { CodexRpc, type RpcData } from "./codex-rpc";
import { publicOpenaiConfig, requireOpenaiConfig } from "./openai-config";
import type { AiConnectionStatus } from "../shared/ai-connection";

const schema = z
  .object({
    provider: z.enum(["codex", "openai"]),
    model: z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,100}$/)
      .optional(),
  })
  .strict();
const location = (s: Store) => path.join(s.root, "ai-connection.local.json");
export function selectedConnection(s: Store) {
  return existsSync(location(s))
    ? schema.parse(JSON.parse(readFileSync(location(s), "utf8")))
    : { provider: "openai" as const };
}
export type CodexStatus = {
  connected: boolean;
  accountType: string | null;
  model: string;
  imageGeneration: boolean;
  models: { model: string; displayName: string; isDefault: boolean }[];
  message: string;
};
type Connection = {
  rpc: CodexRpc;
  status: CodexStatus;
  disabledServers: RpcData;
  checkedAt: number;
};
const shared = globalThis as typeof globalThis & {
  workbenchCodex?: Map<string, Promise<Connection>>;
};
const connections = (shared.workbenchCodex ??= new Map<
  string,
  Promise<Connection>
>());

export async function codexConnection(s: Store): Promise<Connection> {
  let pending = connections.get(s.root);
  if (!pending) {
    pending = (async () => {
      const cwd = path.join(s.root, "codex-workspaces");
      mkdirSync(cwd, { recursive: true });
      const rpc = new CodexRpc(cwd);
      rpc.notices.add((method) => {
        if (method === "workbench/disconnected") connections.delete(s.root);
      });
      try {
        await rpc.initialize();
        const account = await rpc.request("account/read", {
          refreshToken: false,
        });
        const type = (account.account as RpcData | null)?.type;
        const catalogue = await rpc.request("model/list", {
          limit: 100,
          includeHidden: false,
        });
        const capabilities = await rpc.request(
          "modelProvider/capabilities/read",
        );
        const servers = await rpc.request("mcpServerStatus/list", {});
        const models = (catalogue.data as RpcData[]).map((m) => ({
          model: String(m.model),
          displayName: String(m.displayName),
          isDefault: !!m.isDefault,
        }));
        const status: CodexStatus = {
          connected: type === "chatgpt",
          accountType: type ? String(type) : null,
          model:
            models.find((m) => m.isDefault)?.model ?? models[0]?.model ?? "",
          models,
          imageGeneration: !!capabilities.imageGeneration,
          message:
            type === "chatgpt"
              ? "本机 ChatGPT 登录已就绪，使用订阅中的 Codex 额度。"
              : "请先在本机 Codex 中使用 ChatGPT 账号登录，再重新检测。",
        };
        return {
          rpc,
          status,
          disabledServers: Object.fromEntries(
            ((servers.data as RpcData[]) ?? []).map((server) => [
              String(server.name),
              { enabled: false },
            ]),
          ),
          checkedAt: Date.now(),
        };
      } catch (error) {
        rpc.close();
        throw error;
      }
    })();
    connections.set(s.root, pending);
    void pending.catch(() => connections.delete(s.root));
  }
  return pending;
}
export async function refreshCodexStatus(s: Store) {
  const c = await codexConnection(s);
  const account = await c.rpc.request("account/read", { refreshToken: false });
  c.status.accountType =
    String((account.account as RpcData | null)?.type ?? "") || null;
  c.status.connected = c.status.accountType === "chatgpt";
  c.status.message = c.status.connected
    ? "本机 ChatGPT 登录已就绪，使用订阅中的 Codex 额度。"
    : "请先在本机 Codex 中使用 ChatGPT 账号登录，再重新检测。";
  c.checkedAt = Date.now();
  return c.status;
}
export async function connectionStatus(s: Store): Promise<AiConnectionStatus> {
  const selected = selectedConnection(s);
  if (selected.provider === "openai")
    return {
      ...publicOpenaiConfig(s),
      provider: "openai",
      message: "使用独立计费的 OpenAI API",
      models: [],
    };
  try {
    const c = await codexConnection(s);
    if (Date.now() - c.checkedAt > 30_000) await refreshCodexStatus(s);
    const model = selected.model ?? c.status.model;
    const configured =
      c.status.connected && c.status.models.some((m) => m.model === model);
    return {
      ...c.status,
      provider: "codex",
      model,
      configured,
      message:
        configured || !c.status.connected
          ? c.status.message
          : "所选模型当前不可用，请重新选择。",
    };
  } catch {
    return {
      provider: "codex",
      configured: false,
      model: selected.model ?? "",
      models: [],
      imageGeneration: false,
      message: "本机 Codex 暂时无法连接，请检查安装、登录与网络后重新检测。",
    };
  }
}
export async function saveConnection(s: Store, input: unknown) {
  const d = schema.parse(input);
  if (d.provider === "codex") {
    const c = await codexConnection(s);
    assert(c.status.connected, "请先在本机 Codex 中使用 ChatGPT 账号登录");
    if (d.model)
      assert(
        c.status.models.some((m) => m.model === d.model),
        "此模型不在本机 Codex 可用列表中",
      );
    d.model ??= c.status.model;
  }
  const tmp = `${location(s)}.${id()}.tmp`;
  writeFileSync(tmp, JSON.stringify(d), { mode: 0o600, flag: "wx" });
  renameSync(tmp, location(s));
  return connectionStatus(s);
}
export async function ensureConnection(s: Store) {
  if (selectedConnection(s).provider === "openai") {
    requireOpenaiConfig(s);
    return;
  }
  const status = await connectionStatus(s);
  if (!status.configured)
    throw new DomainError("CODEX_UNAVAILABLE", status.message, 409);
}
export async function closeCodexConnection(s: Store) {
  const current = connections.get(s.root);
  if (current) {
    try {
      (await current).rpc.close();
    } catch {
      /* Already disconnected. */
    }
  }
  if (connections.get(s.root) === current) connections.delete(s.root);
}
