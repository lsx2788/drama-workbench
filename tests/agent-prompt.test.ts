import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store, getStore } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import {
  createAgent,
  postHumanMessage,
} from "../src/server/collaboration-service";
import {
  promptSettings,
  promptVersion,
  messagePrompt,
  updateAgentPrompt,
} from "../src/server/agent-prompt-service";
import { workspace } from "../src/server/read-service";
import { handleApi } from "../src/server/api";

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-prompt-"));
  const s = new Store(root);
  t.after(() => {
    if (s.db.isOpen) s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  return s;
}
function project(s: Store, name = "提示词验收") {
  const p = String(createProjectWithCoordinator(s, { name }).id),
    w = workspace(s, p);
  return {
    p,
    agentId: String(w.agents[0].id),
    sessionId: String(w.sessions[0].id),
    nodeId: String(w.nodes[0].id),
  };
}
test("prompt edits are local, immutable and pinned per submitted message across restart", (t) => {
  const s = setup(t),
    a = project(s),
    other = project(s, "另一项目");
  const initial = promptSettings(s, a.p, a.agentId);
  const first = postHumanMessage(s, a.p, a.sessionId, {
    content: "修改前",
  }).message!;
  const instructions = "  你是总控。\r\n每次只确认一个问题。  ";
  const updated = updateAgentPrompt(s, a.p, a.agentId, {
    instructions,
    expectedVersion: initial.current.version,
  });
  assert.equal(updated.current.version, 2);
  assert.equal(updated.current.instructions, instructions);
  assert.deepEqual(promptVersion(s, a.p, a.agentId, 1), initial.current);
  assert.equal(
    promptSettings(s, other.p, other.agentId).current.instructions,
    initial.current.instructions,
  );
  const second = postHumanMessage(s, a.p, a.sessionId, {
    content: "修改后",
  }).message!;
  assert.equal(messagePrompt(s, a.p, String(first.id)).snapshot?.version, 1);
  assert.equal(messagePrompt(s, a.p, String(second.id)).snapshot?.version, 2);
  assert.deepEqual(
    workspace(s, a.p).messages.map((m) => m.prompt_version),
    [1, 2],
  );
  assert.throws(
    () =>
      s.run(
        "UPDATE agent_prompt_versions SET instructions='改历史' WHERE agent_id=? AND version=1",
        a.agentId,
      ),
    /immutable/,
  );
  assert.throws(
    () =>
      s.run(
        "DELETE FROM message_prompt_versions WHERE message_id=?",
        String(first.id),
      ),
    /immutable/,
  );
  s.close();
  const reopened = new Store(s.root);
  try {
    assert.equal(
      promptSettings(reopened, a.p, a.agentId).current.instructions,
      instructions,
    );
    assert.equal(
      messagePrompt(reopened, a.p, String(first.id)).snapshot?.instructions,
      initial.current.instructions,
    );
  } finally {
    reopened.close();
  }
});
test("stale prompt writes cannot overwrite another edit, identical retry does not create revisions", (t) => {
  const s = setup(t),
    a = project(s);
  const input = { instructions: "先确认方向。", expectedVersion: 1 };
  const result = updateAgentPrompt(s, a.p, a.agentId, input);
  assert.deepEqual(updateAgentPrompt(s, a.p, a.agentId, input), result);
  assert.throws(
    () =>
      updateAgentPrompt(s, a.p, a.agentId, {
        ...input,
        instructions: "另一个编辑",
      }),
    /别处更新/,
  );
  assert.equal(promptSettings(s, a.p, a.agentId).versions.length, 2);
  assert.throws(
    () =>
      updateAgentPrompt(s, a.p, a.agentId, {
        instructions: "  ",
        expectedVersion: 2,
      }),
    /不能为空/,
  );
  assert.throws(() =>
    updateAgentPrompt(s, a.p, a.agentId, {
      instructions: "有效",
      expectedVersion: 2,
      provider: "other",
    }),
  );
});
test("prompt and message snapshot failures roll back, including agent creation", (t) => {
  const s = setup(t),
    a = project(s);
  s.db.exec(
    "CREATE TRIGGER fail_prompt BEFORE INSERT ON agent_prompt_versions BEGIN SELECT RAISE(ABORT,'snapshot failure'); END;",
  );
  assert.throws(
    () =>
      updateAgentPrompt(s, a.p, a.agentId, {
        instructions: "失败的修改",
        expectedVersion: 1,
      }),
    /snapshot failure/,
  );
  assert.equal(workspace(s, a.p).agents[0].config_version, 1);
  assert.throws(
    () =>
      createAgent(s, a.p, {
        nodeId: a.nodeId,
        name: "另一个AI",
        purpose: "协作",
      }),
    /snapshot failure/,
  );
  assert.equal(workspace(s, a.p).agents.length, 1);
  s.db.exec(
    "DROP TRIGGER fail_prompt; CREATE TRIGGER fail_message_prompt BEFORE INSERT ON message_prompt_versions BEGIN SELECT RAISE(ABORT,'message snapshot failure'); END;",
  );
  assert.throws(
    () => postHumanMessage(s, a.p, a.sessionId, { content: "失败的消息" }),
    /message snapshot failure/,
  );
  assert.equal(workspace(s, a.p).messages.length, 0);
});
test("legacy migration archives only the current prompt and does not invent old message bindings", (t) => {
  const s = setup(t),
    a = project(s);
  const msg = postHumanMessage(s, a.p, a.sessionId, {
    content: "历史消息",
  }).message!;
  s.db.exec(
    "DROP TABLE message_prompt_versions; DROP TABLE agent_prompt_versions; DELETE FROM schema_migrations WHERE version=12;",
  );
  const original = String(
    s.one("SELECT instructions FROM agents WHERE id=?", a.agentId)!
      .instructions,
  );
  s.close();
  const migrated = new Store(s.root);
  try {
    assert.equal(
      promptSettings(migrated, a.p, a.agentId).current.origin,
      "baseline",
    );
    assert.equal(
      promptSettings(migrated, a.p, a.agentId).current.instructions,
      original,
    );
    assert.equal(messagePrompt(migrated, a.p, String(msg.id)).snapshot, null);
    const next = postHumanMessage(migrated, a.p, a.sessionId, {
      content: "升级后的消息",
    }).message!;
    assert.equal(
      messagePrompt(migrated, a.p, String(next.id)).snapshot?.instructions,
      original,
    );
  } finally {
    migrated.close();
  }
  const reopened = new Store(s.root);
  try {
    assert.equal(promptSettings(reopened, a.p, a.agentId).versions.length, 1);
    assert.equal(
      messagePrompt(reopened, a.p, String(msg.id)).basis,
      "unrecorded",
    );
    assert.equal(reopened.all("PRAGMA foreign_key_check").length, 0);
  } finally {
    reopened.close();
  }
});
test("prompt APIs enforce project scope, history lookup, origin and optimistic concurrency", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-prompt-api-"));
  const oldDir = process.env.DATA_DIR,
    oldToken = process.env.WORKBENCH_TOKEN;
  process.env.DATA_DIR = root;
  delete process.env.WORKBENCH_TOKEN;
  const s = getStore(),
    a = project(s),
    other = project(s);
  t.after(() => {
    s.close();
    if (oldDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDir;
    if (oldToken === undefined) delete process.env.WORKBENCH_TOKEN;
    else process.env.WORKBENCH_TOKEN = oldToken;
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const request = (
    parts: string[],
    method = "GET",
    body?: unknown,
    query = "",
    origin = "http://localhost:3000",
  ) =>
    handleApi(
      new Request(`http://localhost:3000/api/v1/${parts.join("/")}${query}`, {
        method,
        headers: { origin, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      parts,
    );
  const endpoint = ["projects", a.p, "agents", a.agentId, "prompt"];
  assert.equal((await request(endpoint)).status, 200);
  assert.equal(
    (
      await request(
        endpoint,
        "PATCH",
        { expectedVersion: 1, instructions: "新版" },
        "",
        "http://foreign.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(endpoint, "PATCH", {
        expectedVersion: 1,
        instructions: "新版",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(endpoint, "PATCH", {
        expectedVersion: 1,
        instructions: "过时修改",
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(endpoint, "GET", undefined, "?version=1")).status,
    200,
  );
  assert.equal(
    (await request(endpoint, "GET", undefined, "?version=999")).status,
    404,
  );
  assert.equal(
    (await request(endpoint, "GET", undefined, "?version=bad")).status,
    400,
  );
  assert.equal(
    (await request(["projects", other.p, "agents", a.agentId, "prompt"]))
      .status,
    404,
  );
  const msg = postHumanMessage(s, a.p, a.sessionId, {
    content: "新消息",
  }).message!;
  const response = await request([
    "projects",
    a.p,
    "messages",
    String(msg.id),
    "prompt",
  ]);
  assert.equal((await response.json()).data.snapshot.instructions, "新版");
  assert.equal(
    (await request(["projects", other.p, "messages", String(msg.id), "prompt"]))
      .status,
    404,
  );
});
