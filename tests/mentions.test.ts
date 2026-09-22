import test from "node:test";
import assert from "node:assert/strict";
import { remarkMentions } from "../src/shared/ui/remark-mentions";

test("mentions in the middle, multiple mentions and missing spaces become bold names plus a space", () => {
  const tree = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "请 @原作分析AI分析，@编剧 AI  补充。" },
        ],
      },
    ],
  };
  remarkMentions({ names: ["原作分析 AI", "编剧 AI"] })!(tree);
  assert.deepEqual(tree.children[0].children, [
    { type: "text", value: "请 " },
    { type: "strong", children: [{ type: "text", value: "@原作分析AI" }] },
    { type: "text", value: " " },
    { type: "text", value: "分析，" },
    { type: "strong", children: [{ type: "text", value: "@编剧 AI" }] },
    { type: "text", value: " " },
    { type: "text", value: "补充。" },
  ]);
});
test("mention formatting leaves code, URLs, email and unknown names untouched", () => {
  const tree = {
    type: "root",
    children: [
      { type: "code", value: "@编剧 AI" },
      {
        type: "paragraph",
        children: [
          { type: "inlineCode", value: "@编剧 AI" },
          { type: "link", children: [{ type: "text", value: "@编剧 AI" }] },
          { type: "text", value: "test@编剧 AI @未知AI @编剧 AIs" },
        ],
      },
    ],
  };
  const before = structuredClone(tree);
  remarkMentions({ names: ["编剧 AI"] })!(tree);
  assert.deepEqual(tree, before);
});
