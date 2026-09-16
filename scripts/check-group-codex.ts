// Opt-in end-to-end subscription test; all data goes into an isolated directory.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import {
  saveConnection,
  closeCodexConnection,
} from "../src/server/codex-connection";
import { queueAiTurn, executeAiTurn } from "../src/server/ai-runtime";
import { importStory } from "../src/server/story-service";
import { startPreparation } from "../src/server/preparation-service";
import { groupCandidates, setGroupMember } from "../src/server/group-service";

const root = mkdtempSync(path.resolve("data/group-integration-")),
  s = new Store(root);
try {
  await saveConnection(s, { provider: "codex" });
  const p = String(
      createProjectWithCoordinator(s, { name: "群聊独立验收" }).id,
    ),
    ss = String(s.one("SELECT id FROM sessions")!.id);
  const story = importStory(
    s,
    {
      source: "text",
      text: "青禾二十岁时，在渡口救下了账房女儿云笙。云笙认出青禾手中的断剑属于失踪的父亲，两人决定循着剑上的莲纹寻找真相。",
      title: "青禾短篇",
      importKey: randomUUID(),
    },
    p,
  );
  startPreparation(s, p, { coordinatorSessionId: ss });
  const child = String(
    groupCandidates(s, p, ss).find((r) => r.name === "原作初步分析 AI")!.id,
  );
  setGroupMember(s, p, ss, child, "active");
  async function send(
    content: string,
    mentions: string[] = [],
    storyIds: string[] = [],
  ) {
    const turn = queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      content,
      mentionSessionIds: mentions,
      storyIds,
    });
    await executeAiTurn(s, p, String(turn.id));
    const result = s.one(
      "SELECT status,error FROM ai_turns WHERE id=?",
      String(turn.id),
    )!;
    assert.equal(result.status, "completed", String(result.error));
    console.log(
      JSON.stringify({
        turn: turn.id,
        status: result.status,
        calls: s.all(
          "SELECT session_id FROM ai_calls WHERE turn_id=?",
          String(turn.id),
        ),
      }),
    );
    return turn;
  }
  await send(
    "@原作初步分析 AI 请按需读取附件，只回答主角是谁和故事一句话概况。这是通信验收，不保存制作结论，不推进流程；原作分析 AI 请记住验收暗号青禾42。总控如无必要补充请遵循系统静默规则，不再转发同一问题。",
    [child],
    [String(story.story.id)],
  );
  const thread = s.one(
    "SELECT thread_id FROM codex_sessions WHERE session_id=?",
    child,
  )!.thread_id;
  assert.ok(
    s.one(
      "SELECT 1 FROM messages m JOIN group_messages gm ON gm.message_id=m.id WHERE m.session_id=? AND m.sender_type='agent' AND gm.group_id=?",
      child,
      ss,
    ),
  );
  setGroupMember(s, p, ss, child, "paused");
  assert.throws(() =>
    queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      content: "不应发送",
      mentionSessionIds: [child],
    }),
  );
  await closeCodexConnection(s);
  setGroupMember(s, p, ss, child, "active");
  await send(
    "@原作初步分析 AI 我刚才让你记住的验收暗号是什么？只回复暗号即可。总控无需复述，保持静默。",
    [child],
  );
  assert.equal(
    s.one("SELECT thread_id FROM codex_sessions WHERE session_id=?", child)!
      .thread_id,
    thread,
  );
  assert.ok(
    String(
      s.one(
        "SELECT content FROM messages WHERE session_id=? AND sender_type='agent' ORDER BY rowid DESC LIMIT 1",
        child,
      )!.content,
    ).includes("青禾42"),
  );
  const final = await send(
    "只向总控确认：这轮请只回复‘收到’，不要调用子 AI，不要创建任何制作节点。",
  );
  assert.deepEqual(
    s
      .all("SELECT session_id FROM ai_calls WHERE turn_id=?", String(final.id))
      .map((r) => r.session_id),
    [ss],
  );
  console.log(
    JSON.stringify({
      passed: true,
      root,
      p,
      ss,
      child,
      thread,
      silentTurns: s.one("SELECT count(*) n FROM group_silences")!.n,
    }),
  );
} finally {
  await closeCodexConnection(s);
  s.close();
}
