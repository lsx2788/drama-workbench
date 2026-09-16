// Explicit, opt-in integration smoke test. Uses the signed-in subscription.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

const root = mkdtempSync(path.resolve("data/codex-integration-"));
const s = new Store(root);
try {
  await saveConnection(s, { provider: "codex" });
  const p = String(
    createProjectWithCoordinator(s, { name: "本机 Codex 独立验收" }).id,
  );
  const ss = String(s.one("SELECT id FROM sessions LIMIT 1")!.id);
  async function send(content: string, storyIds: string[] = []) {
    const turn = queueAiTurn(s, p, ss, {
      requestKey: randomUUID(),
      content,
      storyIds,
    });
    await executeAiTurn(s, p, String(turn.id));
    const final = s.one(
      "SELECT status,error FROM ai_turns WHERE id=?",
      String(turn.id),
    );
    console.log(JSON.stringify(final));
    assert.equal(final!.status, "completed", String(final!.error));
    return s
      .all(
        "SELECT content FROM messages WHERE sender_type='agent' ORDER BY rowid DESC LIMIT 1",
      )
      .map((r) => String(r.content))
      .join("");
  }
  console.log(
    await send(
      "这是一项接入测试。请调用 state 获取项目名称，回复项目名称并记住测试暗号‘青禾42’，暂不创建制作流程。",
    ),
  );
  const thread = String(
    s.one("SELECT thread_id FROM codex_sessions WHERE session_id=?", ss)!
      .thread_id,
  );
  // Exercise restoration after an App Server process restart, not just in-memory history.
  await closeCodexConnection(s);
  const answer = await send(
    "刚才的测试暗号是什么？只回复暗号，不要调用工具。不要创建制作流程。",
  );
  console.log(answer);
  assert.ok(answer.includes("青禾42"));
  assert.equal(
    s.one("SELECT thread_id FROM codex_sessions WHERE session_id=?", ss)!
      .thread_id,
    thread,
  );
  if (!process.argv.includes("--resume-only")) {
    const source = importStory(
      s,
      {
        source: "text",
        title: "接入验收短篇",
        text: "青禾二十岁时，在渡口救下了账房女儿云笙。云笙认出青禾手中的断剑属于失踪的父亲，两人决定循着剑上的莲纹寻找真相。",
        importKey: randomUUID(),
      },
      p,
    );
    console.log(
      await send(
        "请通过 prepare 找到原作分析 AI，并让它按需读取我附带的短篇，返回故事基本信息和主角，不要确认需求或框架。此轮只做原作理解。",
        [String(source.story.id)],
      ),
    );
    assert.ok(
      Number(s.one("SELECT count(*) AS n FROM codex_sessions")!.n) >= 2,
    );
  }
  if (process.argv.includes("--image")) {
    const sample = path.resolve(
      "data/codex-workspaces/diagnostic/smoke-image.png",
    );
    const image = importStory(
      s,
      {
        source: "file",
        name: "leaf.png",
        bytes: existsSync(sample)
          ? readFileSync(sample)
          : Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kE3sAAAAASUVORK5CYII=",
              "base64",
            ),
        importKey: randomUUID(),
      },
      p,
    );
    console.log(
      await send(
        "这是图片接入测试。请调用 view_source 看我附的图片，简单说出画面是什么；另使用原生图片生成功能生成一张蓝色叶子插画，白色背景，无文字。只生成一张。",
        [String(image.story.id)],
      ),
    );
    assert.ok(s.one("SELECT 1 FROM ai_images"));
  }
  console.log(
    JSON.stringify({
      passed: true,
      root,
      thread,
      tools: s.all("SELECT name FROM ai_tool_events").length,
      images: s.one("SELECT count(*) AS n FROM ai_images")!.n,
    }),
  );
} finally {
  await closeCodexConnection(s);
  s.close();
}
