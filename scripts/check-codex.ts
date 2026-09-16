import { CodexRpc } from "../src/server/codex-rpc";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const cwd = path.resolve("data/codex-workspaces/diagnostic");
mkdirSync(cwd, { recursive: true });
const rpc = new CodexRpc(cwd);
try {
  await rpc.initialize();
  const account = await rpc.request("account/read", { refreshToken: false });
  const models = await rpc.request("model/list", {
    limit: 50,
    includeHidden: false,
  });
  const caps = await rpc.request("modelProvider/capabilities/read");
  const servers = await rpc.request("mcpServerStatus/list", {});
  console.log(
    JSON.stringify({
      accountType: (account.account as Record<string, unknown>)?.type,
      models: (models.data as Record<string, unknown>[]).map((m) => ({
        model: m.model,
        isDefault: m.isDefault,
      })),
      capabilities: caps,
      servers: (servers.data as Record<string, unknown>[])?.map((v) => ({
        name: v.name,
        tools: Object.keys((v.tools ?? {}) as object),
      })),
    }),
  );
  if (process.argv.includes("--smoke") || process.argv.includes("--image")) {
    const imageTest = process.argv.includes("--image");
    rpc.onRequest = async (method, params) => {
      if (method === "item/tool/call" && params.tool === "workbench_probe")
        return {
          success: true,
          contentItems: [
            { type: "inputText", text: "本地桥接确认码：bridge-ok" },
          ],
        };
      throw new Error("Denied");
    };
    const disabled = Object.fromEntries(
      (servers.data as Record<string, unknown>[]).map((row) => [
        String(row.name),
        { enabled: false },
      ]),
    );
    const thread = await rpc.request("thread/start", {
      model: "gpt-6-astra",
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      environments: [],
      ephemeral: true,
      baseInstructions: imageTest
        ? "你是图片生成接入验收助手，请用原生图片生成能力完成指定图片，禁止使用代码绘图。"
        : "你是工作台接入验收助手。只用 workbench_probe 工具核对连接，最后回复确认码。",
      config: { mcp_servers: disabled, "features.image_generation": imageTest },
      dynamicTools: [
        {
          type: "function",
          name: "workbench_probe",
          description: "验证本机连接",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
    });
    const tid = String((thread.thread as Record<string, unknown>).id);
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("smoke timeout")),
        240000,
      );
      rpc.notices.add((method, params) => {
        if (params.threadId !== tid) return;
        if (method === "item/completed") {
          const item = params.item as Record<string, unknown>;
          if (item.type === "agentMessage")
            console.log(JSON.stringify({ reply: item.text }));
          if (item.type === "imageGeneration") {
            console.log(
              JSON.stringify({
                imageStatus: item.status,
                resultLength: String(item.result ?? "").length,
                savedPath: item.savedPath,
                failure: item.failure,
              }),
            );
            if (item.result)
              writeFileSync(
                path.join(cwd, "smoke-image.png"),
                Buffer.from(String(item.result), "base64"),
              );
          }
        }
        if (method === "turn/completed") {
          clearTimeout(timeout);
          console.log(
            JSON.stringify({
              turnStatus: (params.turn as Record<string, unknown>).status,
            }),
          );
          resolve();
        }
      });
    });
    await rpc.request("turn/start", {
      threadId: tid,
      input: [
        {
          type: "text",
          text: imageTest
            ? "为验证短剧网页生图接入，请生成一张简单图片：浅灰背景上一片绿色树叶，无文字。只生成一张。"
            : "请调用 workbench_probe 再回复确认码。",
          text_elements: [],
        },
      ],
      effort: "low",
    });
    await completed;
  }
} finally {
  rpc.close();
}
