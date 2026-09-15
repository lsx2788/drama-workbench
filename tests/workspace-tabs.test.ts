import test from "node:test";
import assert from "node:assert/strict";
import { tabReducer, type TabState } from "../src/client/workspace-tabs";

test("internal pages keep identity and conversation context when reopening or switching projects", () => {
  let state: TabState = { pages: [], activeId: "" };
  state = tabReducer(state, {
    type: "open",
    page: {
      projectId: "one",
      kind: "coordinator",
      title: "总控聊天",
      targetId: "saved-session",
      quoteId: "message",
    },
  });
  const first = state.activeId;
  state = tabReducer(state, {
    type: "open",
    page: { projectId: "two", kind: "coordinator", title: "总控聊天" },
  });
  assert.notEqual(state.activeId, first);
  state = tabReducer(state, {
    type: "open",
    page: { projectId: "one", kind: "coordinator", title: "总控聊天" },
  });
  assert.equal(state.pages.length, 2);
  assert.equal(state.activeId, first);
  assert.equal(state.pages[0].targetId, "saved-session");
  assert.equal(state.pages[0].quoteId, "message");
  state = tabReducer(state, { type: "clearQuote", id: first });
  assert.equal(state.pages[0].quoteId, undefined);
  for (const targetId of ["session-a", "session-b", "session-a"])
    state = tabReducer(state, {
      type: "open",
      page: { projectId: "one", kind: "chat", title: "相同标题", targetId },
    });
  assert.equal(state.pages.length, 4);
  assert.equal(
    state.pages.find((p) => p.id === state.activeId)?.targetId,
    "session-a",
  );
});

test("closing pages keeps another valid page active, including the last page", () => {
  let state: TabState = { pages: [], activeId: "" };
  for (const kind of ["coordinator", "flow", "assets"] as const)
    state = tabReducer(state, {
      type: "open",
      page: { projectId: "one", kind, title: kind },
    });
  const [chat, flow, assets] = state.pages;
  state = tabReducer(state, { type: "select", id: flow.id });
  state = tabReducer(state, { type: "close", id: chat.id });
  assert.equal(state.activeId, flow.id);
  state = tabReducer(state, { type: "close", id: flow.id });
  assert.equal(state.activeId, assets.id);
  assert.deepEqual(tabReducer(state, { type: "select", id: "missing" }), state);
  state = tabReducer(state, { type: "close", id: assets.id });
  assert.deepEqual(state, { pages: [], activeId: "" });
});
