// Explicit integration check using the locally signed-in subscription, in isolation.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { importStory } from "../src/server/story-service";
import {
  saveConnection,
  closeCodexConnection,
} from "../src/server/codex-connection";
import { queueAiTurn, executeAiTurn } from "../src/server/ai-runtime";
import { workspace } from "../src/server/read-service";
const root = mkdtempSync(path.resolve("data/outline-integration-")),
  s = new Store(root);
try {
  await saveConnection(s, { provider: "codex" });
  const imported = importStory(s, {
    source: "text",
    title: "御剑短片流程验收",
    text: "云澜御剑飞过峡谷和云海，最后停在山峰上。",
    importKey: randomUUID(),
  });
  const p = String(imported.project.id),
    ss = String(workspace(s, p).sessions[0].id);
  const turn = queueAiTurn(s, p, ss, {
    requestKey: randomUUID(),
    content:
      "故事就是云澜御剑飞过峡谷和云海，最后停在山峰上。我的初步目标是30秒单条视觉短片、真人影视感、竖屏，不扩写故事。先不用分析原作，也不用讨论姿势或运镜细节。请现在给我一份可点击查看的整体制作流程大纲草案，展示先后关系和各步交付物。可以列出待讨论条件，不要创建正式制作节点。",
  });
  await executeAiTurn(s, p, String(turn.id));
  const final = s.one(
    "SELECT status,error FROM ai_turns WHERE id=?",
    String(turn.id),
  )!;
  assert.equal(final.status, "completed", String(final.error));
  const w = workspace(s, p);
  assert.ok(w.workflowOutlines.length > 0);
  assert.equal(w.nodes.length, 1);
  assert.ok(w.workflows.every((r) => r.status === "draft"));
  const outline = w.workflowOutlines[0];
  assert.ok(w.messages.some((m) => m.id === outline.message_id));
  console.log(
    JSON.stringify({
      passed: true,
      root,
      project: p,
      session: ss,
      outline: outline.id,
      title: outline.content.title,
      steps: outline.content.steps.length,
    }),
  );
} finally {
  await closeCodexConnection(s);
  s.close();
}
