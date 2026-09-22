import test from "node:test";
import assert from "node:assert/strict";
import {
  discussionMessages,
  discussionTimeline,
  messageReplyBody,
  isProcessMessage,
} from "../src/features/discussion/message-presentation";
import type { Message } from "../src/domain/types";
const message = (id: string, extra: Partial<Message> = {}): Message => ({
  id,
  sender: "资产制作 AI",
  text: id,
  time: "2026-09-20",
  taskId: "asset",
  ...extra,
});

test("adjacent internal records collapse but questions, final answers and attachments stay visible", () => {
  const original = [
    message("delegate", { audience: "agents" }),
    message("progress", { audience: "human", phase: "commentary" }),
    message("question", {
      confirmation: { status: "pending" },
      audience: "agents",
    }),
    message("final", { audience: "human", phase: "final_answer" }),
    message("handoff", {
      questionTransfer: { questionId: "q", status: "pending" },
    }),
    message("user", { sender: "你", audience: "agents" }),
  ];
  const entries = discussionTimeline(original);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.id]),
    [
      ["activity", "delegate"],
      ["message", "question"],
      ["message", "final"],
      ["activity", "handoff"],
      ["message", "user"],
    ],
  );
  assert.equal(entries[0].kind === "activity" && entries[0].messages.length, 2);
  assert.equal(
    isProcessMessage(
      message("image", {
        audience: "agents",
        image: { id: "i", status: "completed", name: "角色", current: true },
      }),
    ),
    false,
  );
  assert.equal(original.length, 6);
});
test("composer quote is separated from reply only when the original text matches exactly", () => {
  const original = message("question", { text: "问题第一行\n第二行" });
  const reply = message("user", {
    sender: "你",
    replyToId: "question",
    text: "> 问题第一行\n> 第二行\n\n我的实际回答",
  });
  assert.equal(messageReplyBody(reply, [original]).text, "我的实际回答");
  assert.equal(messageReplyBody(reply, [original]).quote?.id, original.id);
  const ownQuote = { ...reply, text: "> 这是我的引文\n\n回答" };
  assert.equal(messageReplyBody(ownQuote, [original]).text, ownQuote.text);
  assert.equal(messageReplyBody(reply, []).text, reply.text);
});
test("image generation and revisions update a stable task card without hiding questions or unrelated messages", () => {
  const original = [
    message("job", { execution: { status: "reviewing" } }),
    message("first", {
      image: { id: "g1", status: "completed", name: "旧图", current: false },
    }),
    message("question", { confirmation: { status: "pending" } }),
    message("other", {
      taskId: "other",
      image: { id: "g2", status: "completed", name: "另一张图", current: true },
    }),
    message("retry", {
      image: {
        id: "g3",
        status: "failed",
        name: "返修图",
        current: false,
        error: "出图失败",
      },
    }),
  ];
  const result = discussionMessages(original);
  assert.deepEqual(
    result.map((m) => m.id),
    ["job", "question", "other"],
  );
  assert.equal(result[0].image?.error, "出图失败");
  assert.equal(result[0].execution?.status, "reviewing");
  assert.equal(original[0].image, undefined);
  assert.equal(original.length, 5);
});
test("separate executions of one task keep their own image history", () => {
  const result = discussionMessages([
    message("job1", { execution: { status: "returned" } }),
    message("image1", {
      image: { id: "g1", status: "completed", name: "旧图", current: false },
    }),
    message("job2", { execution: { status: "completed" } }),
    message("image2", {
      image: { id: "g2", status: "completed", name: "新图", current: true },
    }),
  ]);
  assert.deepEqual(
    result.map((m) => [m.id, m.image?.id]),
    [
      ["job1", "g1"],
      ["job2", "g2"],
    ],
  );
});
