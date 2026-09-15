import test from "node:test";
import assert from "node:assert/strict";
import { decodeStoryText, isStoryText } from "../src/client/story-text";
import { tabReducer, type TabState } from "../src/client/workspace-tabs";

test("text viewing preserves Unicode and whitespace without interpreting markup or modifying bytes", () => {
  const text =
    "\ufeff  第一章\r\n\r\n<script>不执行</script>\n# 原始 Markdown\t🙂  ";
  const bytes = new TextEncoder().encode(text);
  const before = [...bytes];
  assert.deepEqual(decodeStoryText(bytes.buffer, "utf-8"), { text });
  assert.deepEqual([...bytes], before);
  const legacy = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3]);
  assert.ok(decodeStoryText(legacy.buffer, "utf-8").error);
  assert.equal(decodeStoryText(legacy.buffer, "gb18030").text, "你好");
  assert.deepEqual([...legacy], [0xc4, 0xe3, 0xba, 0xc3]);
  assert.equal(isStoryText("application/pdf"), false);
  assert.equal(isStoryText("text/markdown"), true);
});

test("reader tabs identify each story independently and reuse an already open source", () => {
  let state: TabState = { pages: [], activeId: "" };
  for (const targetId of ["source-a", "source-b", "source-a"])
    state = tabReducer(state, {
      type: "open",
      page: { projectId: "one", kind: "story", targetId, title: "同名故事" },
    });
  assert.equal(state.pages.length, 2);
  assert.equal(
    state.pages.find((p) => p.id === state.activeId)?.targetId,
    "source-a",
  );
});
