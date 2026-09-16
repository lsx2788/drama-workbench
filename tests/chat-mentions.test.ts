import test from "node:test";
import assert from "node:assert/strict";
import {
  findMentions,
  mentionAt,
  selectedMentionIds,
} from "../src/client/chat-mentions";

const members = [
  { id: "reader", name: "原作 AI" },
  { id: "writer", name: "编剧 AI" },
  { id: "reader-long", name: "原作 AI 助手" },
];
test("mentions anywhere target each selected member once and stop targeting removed/edited names", () => {
  const text = "先请@原作 AI 分析，再请@编剧 AI 整理；最后@原作 AI 核对。";
  assert.deepEqual(selectedMentionIds(text, members), ["reader", "writer"]);
  assert.deepEqual(
    findMentions(
      text,
      members.map((m) => m.name),
    ).map((m) => text.slice(m.start, m.end)),
    ["@原作 AI", "@编剧 AI", "@原作 AI"],
  );
  assert.deepEqual(
    selectedMentionIds(text.replaceAll("@原作 AI", "原作 AI"), members),
    ["writer"],
  );
  assert.deepEqual(selectedMentionIds("都不提及了", members), []);
  assert.deepEqual(
    selectedMentionIds("@原作 AIX 不该误发给原作 AI", members),
    [],
  );
  assert.deepEqual(selectedMentionIds("给@原作 AI 助手 看看", members), [
    "reader-long",
  ]);
  assert.deepEqual(selectedMentionIds("普通提到 @编剧 AI", []), []);
  assert.deepEqual(selectedMentionIds("contact@原作 AI", members), []);
  assert.deepEqual(
    selectedMentionIds("请（＠原作 AI），以及@编剧 AI。", members),
    ["reader", "writer"],
  );
  assert.deepEqual(selectedMentionIds("@原作 AI@编剧 AI 一起看看", members), [
    "reader",
    "writer",
  ]);
});

test("picker opens for the new mention at the cursor without swallowing surrounding text", () => {
  const text = "先请@原作 AI 看完，再请@编剧整理，最后汇总";
  const caret = text.indexOf("整理");
  const range = mentionAt(text, caret, ["原作 AI"]);
  assert.deepEqual(range, {
    start: text.indexOf("@编剧"),
    end: caret,
    query: "编剧",
  });
  const inserted =
    text.slice(0, range!.start) + "@编剧 AI " + text.slice(range!.end);
  assert.equal(inserted, "先请@原作 AI 看完，再请@编剧 AI 整理，最后汇总");
  assert.deepEqual(mentionAt("@原作 AI@", 7, ["原作 AI"]), {
    start: 6,
    end: 7,
    query: "",
  });
  assert.equal(mentionAt("请＠原作 AI，看看", 10, ["原作 AI"]), null);
});
