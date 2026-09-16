// Explicit subscription integration check; never modifies a user's project.
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
import { groupCandidates } from "../src/server/group-service";
import { workspace } from "../src/server/read-service";

const root = mkdtempSync(path.resolve("data/dynamic-integration-")),
  s = new Store(root);
try {
  await saveConnection(s, { provider: "codex" });
  const source = importStory(s, {
    source: "text",
    title: "渡口短篇",
    text: "青禾在渡口救下云笙。云笙认出青禾的断剑是失踪父亲的遗物，两人决定循着莲纹寻找真相。",
    importKey: randomUUID(),
  });
  const p = String(source.project.id),
    ss = String(workspace(s, p).sessions[0].id);
  async function send(content: string, storyIds: string[] = []) {
    const turn = queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      content,
      storyIds,
    });
    await executeAiTurn(s, p, String(turn.id));
    const result = s.one(
      "SELECT status,error FROM ai_turns WHERE id=?",
      String(turn.id),
    )!;
    console.log(JSON.stringify({ step: content.slice(0, 24), ...result }));
    assert.equal(result.status, "completed", String(result.error));
  }
  await send(
    "这是协作验收。请只请原作分析 AI 按需读附件，回答主要人物与一句话概况。不要创建编剧 AI，不必保存或审核成果。",
    [String(source.story.id)],
  );
  const reader = groupCandidates(s, p, ss).find(
    (r) => r.name === "原作初步分析 AI",
  )!;
  assert.ok(reader);
  assert.equal(
    s.one(
      "SELECT count(*) n FROM node_ai_profiles WHERE profile_id='screenwriting'",
    )!.n,
    0,
  );
  const thread = s.one(
    "SELECT thread_id FROM codex_sessions WHERE session_id=?",
    String(reader.id),
  )!.thread_id;
  await send(
    "原作分析先告一段落，请让原作分析 AI 退出本轮。现在请编剧 AI 只列出接下来需要向我确认的三个问题，不要保存改编框架或拆分剧集。",
  );
  const after = groupCandidates(s, p, ss),
    writer = after.find((r) => r.name === "改编框架与分集 AI")!;
  assert.ok(writer);
  assert.equal(
    after.find((r) => r.id === reader.id)!.membership_status,
    "paused",
  );
  await send(
    "现在让编剧 AI 先退出，再恢复原作分析 AI，问它：断剑为什么能成为线索？请沿用原来的讨论，不必新增 AI 或保存成果。",
  );
  const final = groupCandidates(s, p, ss);
  assert.equal(
    final.find((r) => r.id === reader.id)!.membership_status,
    "active",
  );
  assert.equal(
    final.find((r) => r.id === writer.id)!.membership_status,
    "paused",
  );
  assert.equal(
    s.one(
      "SELECT thread_id FROM codex_sessions WHERE session_id=?",
      String(reader.id),
    )!.thread_id,
    thread,
  );
  assert.equal(final.length, 3);
  assert.ok(s.one("SELECT 1 FROM message_context"));
  for (const m of workspace(s, p).messages.filter(
    (m) => m.sender_type === "agent",
  ))
    assert.doesNotMatch(
      String(m.display_content),
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|sha256\s*[0-9a-f]{64}/i,
    );
  console.log(
    JSON.stringify({
      passed: true,
      root,
      p,
      ss,
      reader: reader.id,
      writer: writer.id,
      thread,
    }),
  );
} finally {
  await closeCodexConnection(s);
  s.close();
}
