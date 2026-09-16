import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import path from "node:path";
import { DomainError } from "./common";

export type RpcData = Record<string, unknown>;
type Pending = {
  resolve: (v: RpcData) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export type RpcNotice = (method: string, params: RpcData) => void;
export type RpcRequest = (method: string, params: RpcData) => Promise<unknown>;

export function codexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  // Desktop app places its versioned executable on PATH; never invoke a shell wrapper.
  const names = process.platform === "win32" ? ["codex.exe"] : ["codex"];
  for (const folder of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of names) {
      const filename = path.join(/* turbopackIgnore: true */ folder, name);
      if (existsSync(/* turbopackIgnore: true */ filename)) return filename;
    }
  }
  throw new DomainError(
    "CODEX_MISSING",
    "未找到本机 Codex，请安装或通过 CODEX_BIN 指定可执行文件",
    409,
  );
}
export const isolatedCodexConfig = {
  model_provider: "openai",
  forced_login_method: "chatgpt",
  approval_policy: "never",
  sandbox_mode: "read-only",
  web_search: "disabled",
  project_doc_max_bytes: 0,
  mcp_servers: {},
  features: {
    apps: false,
    plugins: false,
    hooks: false,
    shell_tool: false,
    unified_exec: false,
    code_mode: false,
    code_mode_only: false,
    code_mode_host: true,
    browser_use: false,
    computer_use: false,
    multi_agent: false,
    memories: false,
    view_image: false,
    sleep_tool: false,
    goals: false,
    workspace_dependencies: false,
    skill_search: false,
    skill_mcp_dependency_install: false,
    skip_host_skill_discovery: true,
    image_generation: true,
  },
};
function configArgs() {
  const args: string[] = [];
  for (const [key, value] of Object.entries(isolatedCodexConfig)) {
    if (key === "features")
      for (const [name, enabled] of Object.entries(value))
        args.push("-c", `features.${name}=${enabled}`);
    else
      args.push(
        "-c",
        `${key}=${typeof value === "object" ? "{}" : JSON.stringify(value)}`,
      );
  }
  return args;
}

/** JSON-lines stdio: no public port and no application access to OAuth token files. */
export class CodexRpc {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private closed = false;
  readonly notices = new Set<RpcNotice>();
  onRequest: RpcRequest = async () => {
    throw new Error("Unsupported request");
  };
  constructor(
    cwd: string,
    command = codexBinary(),
    args = ["app-server", "--stdio", ...configArgs()],
  ) {
    const env = { ...process.env };
    // A subscription connection must never silently fall back to API billing.
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    delete env.CODEX_ACCESS_TOKEN;
    this.child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: "pipe",
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      void this.receive(line);
    });
    this.child.stderr.on("data", () => {
      /* Do not echo account/config details to app logs. */
    });
    this.child.stdin.on("error", () =>
      this.fail("本机 Codex 通信中断，本轮不会自动重发"),
    );
    this.child.on("error", () =>
      this.fail("本机 Codex 无法启动，请检查安装与权限"),
    );
    this.child.on("exit", () =>
      this.fail("本机 Codex 连接已中断，本轮不会自动重发"),
    );
  }
  private send(value: unknown) {
    if (!this.closed) this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  private async receive(line: string) {
    let msg: RpcData;
    try {
      msg = JSON.parse(line) as RpcData;
    } catch {
      return;
    }
    if (msg.method && msg.id !== undefined) {
      try {
        this.send({
          id: msg.id,
          result: await this.onRequest(
            String(msg.method),
            (msg.params ?? {}) as RpcData,
          ),
        });
      } catch {
        this.send({
          id: msg.id,
          error: { code: -32603, message: "Workbench declined this request" },
        });
      }
    } else if (msg.id !== undefined) {
      const wait = this.pending.get(Number(msg.id));
      if (!wait) return;
      this.pending.delete(Number(msg.id));
      clearTimeout(wait.timer);
      if (msg.error) {
        const code = Number((msg.error as RpcData).code);
        const message = String((msg.error as RpcData).message ?? "");
        if (code === -32600 && /session .+ is archived\./.test(message)) {
          wait.reject(
            new DomainError(
              "CODEX_ARCHIVED",
              "后台会话已收起，需要恢复后续接",
              409,
            ),
          );
          return;
        }
        // Upstream error text can contain local paths or credentials; keep the public error bounded.
        wait.reject(
          new DomainError(
            "CODEX_RPC",
            `本机 Codex 未能执行请求（${code}），请检查连接与模型设置后继续`,
            502,
          ),
        );
      } else wait.resolve((msg.result ?? {}) as RpcData);
    } else if (msg.method)
      for (const notice of this.notices)
        notice(String(msg.method), (msg.params ?? {}) as RpcData);
  }
  request(
    method: string,
    params: unknown = {},
    timeoutMs = 45_000,
  ): Promise<RpcData> {
    if (this.closed)
      return Promise.reject(
        new DomainError("CODEX_CLOSED", "Codex 连接已经关闭", 502),
      );
    const key = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(
          new DomainError(
            "CODEX_TIMEOUT",
            `Codex ${method} 等待超时，本次不自动重试`,
            504,
          ),
        );
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      this.send({ id: key, method, params });
    });
  }
  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "drama_workbench",
        title: "映序短剧工作台",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
  }
  private fail(message: string) {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new DomainError("CODEX_CLOSED", message, 502));
    }
    this.pending.clear();
    for (const notice of this.notices) notice("workbench/disconnected", {});
  }
  close() {
    this.fail("Codex 连接已关闭");
    this.child.kill();
  }
}
