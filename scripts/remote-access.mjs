import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGateway } from "./remote-gateway.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
await mkdir("data/remote", { recursive: true });
const executable =
  process.platform === "win32" ? "data/tools/cloudflared.exe" : "cloudflared";
if (process.platform === "win32") await access(executable);
const children = [];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const launch = (command, args) => {
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop();
  });
  child.on("exit", () => {
    if (!stopping) {
      console.error("A remote-access child stopped.");
      stop();
    }
  });
  return child;
};
async function appReady() {
  try {
    const response = await fetch("http://127.0.0.1:3000/api/v1/projects", {
      signal: AbortSignal.timeout(2000),
      headers: process.env.WORKBENCH_TOKEN
        ? { Authorization: `Bearer ${process.env.WORKBENCH_TOKEN}` }
        : {},
    });
    const body = await response.json();
    return (
      response.ok &&
      Array.isArray(body.data) &&
      typeof body.requestId === "string"
    );
  } catch {
    return false;
  }
}
if (!(await appReady())) {
  const app = launch(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
  ]);
  app.stdout.pipe(process.stdout);
  app.stderr.pipe(process.stderr);
  for (let i = 0; i < 30 && !(await appReady()); i++)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!(await appReady())) {
    console.error("Local app did not become ready. Run npm run build first.");
    stop();
  }
}
const credentials = {
  username: "viewer",
  password: randomBytes(15).toString("base64url"),
};
const allowedHosts = new Set(["127.0.0.1:3100"]);
const gateway = createGateway({
  ...credentials,
  allowedHosts,
  apiToken: process.env.WORKBENCH_TOKEN,
});
gateway.on("error", (error) => {
  console.error(error.message);
  stop();
});
await new Promise((resolve) => gateway.listen(3100, "127.0.0.1", resolve));
const state = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  url: null,
  ...credentials,
};
const save = () =>
  writeFile("data/remote/access.json", JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
await save();
const tunnel = launch(executable, [
  "tunnel",
  "--no-autoupdate",
  "--protocol",
  "http2",
  "--url",
  "http://127.0.0.1:3100",
]);
let output = "";
function capture(chunk) {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-16000);
  const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (url && !state.url) {
    state.url = url[0];
    allowedHosts.add(new URL(state.url).host);
    save().catch((error) => {
      console.error(error.message);
      stop();
    });
  }
}
tunnel.stdout.on("data", capture);
tunnel.stderr.on("data", capture);
console.log(
  "Remote credentials are stored in data/remote/access.json (not in logs or Git).",
);
