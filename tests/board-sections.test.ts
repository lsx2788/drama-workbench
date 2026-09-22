import test from "node:test";
import assert from "node:assert/strict";
import { boardSections } from "../src/features/tasks/board-sections";

test("storyboard grouping preserves whole bullet blocks and leaves actions and unknown restrictions prominent", () => {
  const text =
    "## 镜头5\n\n- **叙事目的**：发现证据\n- 主体动作：悬手\n  0–2秒等待，不能遮挡样品\n- 对白／旁白：无对白\n- 通用视频生成提示词：原始提示词\n  保持人物一致\n- 特殊限制：不得增加路人\n";
  const result = boardSections(text)!;
  assert.match(result.main, /悬手\n  0–2秒等待/);
  assert.match(result.main, /不得增加路人/);
  assert.doesNotMatch(result.main, /原始提示词|无对白/);
  assert.match(result.sound, /无对白/);
  assert.match(result.reference, /原始提示词\n  保持人物一致/);
  const originalBlocks = text.split(/(?=^[-*+]\s+)/m);
  for (const block of originalBlocks)
    assert.equal(
      Object.values(result).filter((section) => section.includes(block)).length,
      1,
    );
});

test("unfamiliar markdown and fenced instructions are rendered unchanged", () => {
  assert.equal(
    boardSections("| 内容 | 时长 |\n|---|---|\n| 悬手 | 7秒 |"),
    null,
  );
  assert.equal(
    boardSections("- 动作：悬手\n- 镜头：固定\n```text\n- 对白：无\n```"),
    null,
  );
});
