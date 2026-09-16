import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const q = JSON.parse(line);
  if (q.method === "error")
    process.stdout.write(
      JSON.stringify({
        id: q.id,
        error: { code: -123, message: "secret-token-should-never-leak" },
      }) + "\n",
    );
  else if (q.method === "exit") process.exit(1);
  else if (q.id !== undefined && q.method !== "timeout")
    process.stdout.write(
      JSON.stringify({
        id: q.id,
        result: {
          method: q.method,
          hasApiKey: !!process.env.OPENAI_API_KEY,
          hasCodexApiKey: !!process.env.CODEX_API_KEY,
        },
      }) + "\n",
    );
});
