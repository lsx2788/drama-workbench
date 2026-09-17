import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/db";
import { importStory, storyFile } from "../src/server/story-service";
import { workspace } from "../src/server/read-service";
import {
  startPreparation,
  savePreparationRecord,
  reviewPreparation,
  preparationRecord,
} from "../src/server/preparation-service";
import { postHumanMessage } from "../src/server/collaboration-service";
import {
  createEpisodes,
  listEpisodes,
  episodeDetail,
  reorderEpisodes,
} from "../src/server/episode-service";
import {
  delegateWriting,
  postAgentMessage,
} from "../src/server/writer-collaboration";
import {
  proposeKnowledge,
  reviewKnowledge,
  knowledge,
} from "../src/server/knowledge-service";
import {
  readStoryRange,
  SOURCE_RANGE_MAX_BYTES,
} from "../src/server/story-range";
import { productionMap } from "../src/client/production-map";
import {
  promptSettings,
  updateAgentPrompt,
  messagePrompt,
} from "../src/server/agent-prompt-service";
import { migrateReviewPolicy, REVIEW_RULES } from "../src/server/review-policy";
import { pendingReviews } from "../src/server/result-review";
import { executeTool } from "../src/server/ai-tools";
import {
  createAsset,
  createVersion,
  addFile,
} from "../src/server/asset-service";

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-preparation-")),
    s = new Store(root);
  t.after(() => {
    if (s.db.isOpen) s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const text = "  林川抵达古城。\r\n他遇到了青禾。\n两人决定同行。🙂\n";
  const imported = importStory(s, {
      source: "text",
      text,
      importKey: randomUUID(),
    }),
    p = String(imported.project.id),
    storyId = String(imported.story.id);
  const coordinator = String(workspace(s, p).sessions[0].id);
  startPreparation(s, p, { coordinatorSessionId: coordinator });
  const setup = startPreparation(s, p, {
    coordinatorSessionId: coordinator,
    profile: "screenwriting",
  });
  const w = workspace(s, p);
  const analyst = String(
      w.sessions.find((row) => row.node_id === setup.analysis_node_id)!.id,
    ),
    writer = String(
      w.sessions.find((row) => row.node_id === setup.writing_node_id)!.id,
    );
  const source = {
    storyId,
    startByte: 0,
    endByte: Buffer.byteLength(text),
    encoding: "utf-8",
    locator: "古城相遇",
  };
  return {
    s,
    p,
    root,
    text,
    storyId,
    coordinator,
    analyst,
    writer,
    setup,
    source,
  };
}
function confirmPlan(f: ReturnType<typeof fixture>) {
  const { s, p, coordinator, analyst, writer, source } = f;
  const overview = savePreparationRecord(s, p, {
    kind: "overview",
    authorSessionId: analyst,
    content: {
      title: "初步概况",
      summary: "古城相遇",
      sources: [source],
      unresolved: ["后续发展未读"],
    },
  });
  reviewPreparation(s, p, String(overview.id), {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    reason: "已核对来源与覆盖范围",
  });
  const confirmation = String(
    postHumanMessage(s, p, coordinator, {
      content: "确认：先做相遇部分，两集，每集一分钟。",
    }).message!.id,
  );
  const requirements = savePreparationRecord(s, p, {
    kind: "requirements",
    authorSessionId: coordinator,
    basisId: overview.id,
    content: {
      title: "制作目标",
      summary: "先做两集",
      episodeCount: 2,
      minutesPerEpisode: 1,
      scope: "古城相遇",
    },
  });
  reviewPreparation(s, p, String(requirements.id), {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    userMessageId: confirmation,
    reason: "用户已确认",
  });
  const framework = savePreparationRecord(s, p, {
    kind: "framework",
    authorSessionId: writer,
    basisId: requirements.id,
    content: {
      title: "改编框架",
      summary: "抵达古城到决定同行",
      details: "保留相遇，不展开后续旅程。",
    },
  });
  return { framework, confirmation, requirements, overview };
}

test("chat cannot approve a deliverable; rejection and resubmission preserve independent review states", (t) => {
  const { s, p, coordinator, analyst, source } = fixture(t);
  const input = {
    kind: "overview",
    authorSessionId: analyst,
    content: { title: "概况", summary: "待核对", sources: [source] },
  };
  const old = savePreparationRecord(s, p, input);
  postHumanMessage(s, p, coordinator, { content: "这个通过了，可以使用" });
  assert.equal(preparationRecord(s, p, String(old.id)).usable, false);
  assert.equal(pendingReviews(s, p).counts.records, 1);
  assert.throws(
    () =>
      reviewPreparation(s, p, String(old.id), {
        coordinatorSessionId: analyst,
        decision: "confirmed",
        reason: "自行通过",
      }),
    /总控/,
  );
  reviewPreparation(s, p, String(old.id), {
    coordinatorSessionId: coordinator,
    decision: "changes_requested",
    reason: "缺少人物来源，请核对原文后重交",
  });
  assert.equal(
    preparationRecord(s, p, String(old.id)).use_blocker,
    "已退回修改",
  );
  const revised = savePreparationRecord(s, p, { ...input, previousId: old.id });
  assert.equal(revised.usable, false);
  reviewPreparation(s, p, String(revised.id), {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    reason: "已核对原文与范围",
  });
  assert.equal(preparationRecord(s, p, String(revised.id)).usable, true);
  assert.equal(
    preparationRecord(s, p, String(old.id)).decision,
    "changes_requested",
  );
  assert.equal(pendingReviews(s, p).counts.records, 0);
});

test("a revised upstream result invalidates downstream use without rewriting historical approvals", (t) => {
  const f = fixture(t),
    { s, p, coordinator, analyst, writer, source } = f;
  const { overview, framework, confirmation } = confirmPlan(f);
  reviewPreparation(s, p, String(framework.id), {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    userMessageId: confirmation,
    reason: "确认框架",
  });
  assert.equal(preparationRecord(s, p, String(framework.id)).usable, true);
  savePreparationRecord(s, p, {
    kind: "overview",
    authorSessionId: analyst,
    previousId: overview.id,
    content: { title: "补充概况", summary: "发现新情节", sources: [source] },
  });
  const stale = preparationRecord(s, p, String(framework.id));
  assert.equal(stale.decision, "confirmed");
  assert.equal(stale.usable, false);
  assert.throws(
    () =>
      createEpisodes(s, p, {
        writerSessionId: writer,
        frameworkId: framework.id,
        requestKey: randomUUID(),
        units: [{ name: "第一集", sources: [source] }],
      }),
    /依据|不可用|重新/,
  );
  assert.equal(listEpisodes(s, p).length, 0);
});

test("asset approval is coordinator-bound and required before publishing linked knowledge", async (t) => {
  const { s, p, coordinator, analyst } = fixture(t);
  const asset = createAsset(s, p, {
    code: "person20",
    name: "20岁林川",
    kind: "character",
  });
  const version = createVersion(s, p, String(asset.id), {});
  addFile(s, p, String(version.id), {
    name: "portrait.txt",
    type: "text/plain",
    bytes: Buffer.from("人物设定：二十岁"),
  });
  const proposal = proposeKnowledge(s, p, {
    authorSessionId: analyst,
    payload: {
      summary: "主角画像",
      entities: [
        {
          code: "lin",
          name: "林川",
          kind: "person",
          assetVersionIds: [version.id],
        },
      ],
    },
  });
  const review = {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    reason: "确认人物",
  };
  assert.throws(
    () => reviewKnowledge(s, p, proposal.id, review),
    /资产尚未审核/,
  );
  assert.equal(knowledge(s, p).entities.length, 0);
  const invoke = (
    session: string,
    profile: string,
    action: string,
    data: unknown,
  ) =>
    executeTool(
      s,
      p,
      session,
      profile,
      { action, data: JSON.stringify(data) },
      async () => {
        throw new Error("must not call a model");
      },
    );
  const approval = {
    id: version.id,
    decision: "approved",
    scope: "二十岁阶段",
    reason: "符合当前角色设定",
  };
  await assert.rejects(
    invoke(analyst, "source-analysis", "review_asset", approval),
    /权限/,
  );
  await assert.rejects(
    invoke(analyst, "coordinator", "review_asset", approval),
    /总控/,
  );
  assert.equal(pendingReviews(s, p).counts.assets, 1);
  await invoke(coordinator, "coordinator", "review_asset", approval);
  assert.equal(
    s.one("SELECT actor FROM reviews WHERE version_id=?", String(version.id))
      ?.actor,
    coordinator,
  );
  reviewKnowledge(s, p, proposal.id, review);
  assert.equal(knowledge(s, p).entities.length, 1);
  const next = createVersion(s, p, String(asset.id), {});
  assert.equal(next.status, "candidate");
  await invoke(coordinator, "coordinator", "review_asset", {
    id: next.id,
    decision: "rejected",
    scope: "二十岁阶段",
    reason: "缺少文件，请补齐后提交新版本",
  });
  await assert.rejects(
    invoke(coordinator, "coordinator", "review_asset", {
      ...approval,
      id: next.id,
    }),
    /不可重写/,
  );
  assert.equal(pendingReviews(s, p).counts.assets, 0);
});

test("review policy upgrade preserves custom prompts and historical session/message bindings", (t) => {
  const { s, p, coordinator } = fixture(t);
  const agentId = String(
    s.one("SELECT agent_id FROM sessions WHERE id=?", coordinator)!.agent_id,
  );
  const before = promptSettings(s, p, agentId);
  updateAgentPrompt(s, p, agentId, {
    expectedVersion: before.current.version,
    instructions: "保留本故事专属风格",
  });
  const message = postHumanMessage(s, p, coordinator, {
    content: "旧消息",
  }).message!;
  const snapshot = messagePrompt(s, p, String(message.id));
  const sessions = s.all("SELECT * FROM sessions ORDER BY id");
  const prior = promptSettings(s, p, agentId);
  s.run("DELETE FROM schema_migrations WHERE version=25");
  migrateReviewPolicy(s);
  const after = promptSettings(s, p, agentId);
  assert.equal(after.current.instructions, prior.current.instructions);
  assert.equal(after.current.version, prior.current.version + 1);
  assert.ok(after.current.layers!.system.instructions.includes(REVIEW_RULES));
  assert.deepEqual(messagePrompt(s, p, String(message.id)), snapshot);
  assert.deepEqual(s.all("SELECT * FROM sessions ORDER BY id"), sessions);
  migrateReviewPolicy(s);
  assert.deepEqual(promptSettings(s, p, agentId), after);
});
test("preparation confirms separate outputs before writer creates stable, empty episodes with exact source references", (t) => {
  const f = fixture(t),
    { s, p, writer, coordinator, source, text, storyId } = f;
  assert.equal(workspace(s, p).overview.workflow, null);
  assert.equal(workspace(s, p).nodes.length, 3);
  startPreparation(s, p, { coordinatorSessionId: coordinator });
  assert.equal(workspace(s, p).nodes.length, 3);
  assert.equal(
    promptSettings(
      s,
      p,
      String(
        workspace(s, p).sessions.find((row) => row.id === writer)!.agent_id,
      ),
    ).current.layers!.system.id,
    "screenwriting",
  );
  const { framework, confirmation } = confirmPlan(f);
  const input = {
    writerSessionId: writer,
    frameworkId: framework.id,
    requestKey: randomUUID(),
    units: [
      { name: "第一集", summary: "抵达古城", sources: [source] },
      { name: "第二集", summary: "决定同行", sources: [source] },
    ],
  };
  assert.throws(() => createEpisodes(s, p, input), /已确认/);
  assert.throws(
    () =>
      reviewPreparation(s, p, String(framework.id), {
        coordinatorSessionId: coordinator,
        decision: "confirmed",
        reason: "未附用户确认",
      }),
    /用户确认消息/,
  );
  reviewPreparation(s, p, String(framework.id), {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    userMessageId: confirmation,
    reason: "确认改编框架",
  });
  const made = createEpisodes(s, p, input);
  assert.equal(made.episodes.length, 2);
  assert.equal(workspace(s, p).nodes.length, 3);
  assert.equal(workspace(s, p).items.length, 0);
  assert.equal(workspace(s, p).documents.length, 0);
  assert.deepEqual(createEpisodes(s, p, input), made);
  assert.throws(
    () =>
      createEpisodes(s, p, {
        ...input,
        units: [{ name: "改变后的第一集", sources: [source] }],
      }),
    /请求已改变/,
  );
  assert.equal(episodeDetail(s, p, "E0001").section_id, made.episodes[0].id);
  const detail = episodeDetail(s, p, "E0001");
  assert.equal(detail.sources[0].story_id, storyId);
  assert.equal(
    readStoryRange(s, p, storyId, {
      startByte: source.startByte,
      endByte: source.endByte,
      encoding: "utf-8",
    }).text,
    text,
  );
  assert.equal(storyFile(s, p, storyId).bytes.toString("utf8"), text);
  assert.equal(listEpisodes(s, p, { around: "E0001", after: 10 }).length, 2);
  reorderEpisodes(s, p, {
    writerSessionId: writer,
    episodeIds: [made.episodes[1].id, made.episodes[0].id],
  });
  assert.equal(episodeDetail(s, p, "E0001").number, 2);
  assert.equal(episodeDetail(s, p, "E0002").number, 1);
  assert.deepEqual(
    listEpisodes(s, p, { around: "E0001", before: 5 }).map((row) => row.code),
    ["E0002", "E0001"],
  );
  const graph = productionMap(workspace(s, p), String(f.setup.workflow_id));
  assert.equal(
    [...graph.targets.values()].filter((row) => row.kind === "unit").length,
    2,
  );
  assert.ok(
    [...graph.targets.values()].some((row) => row.kind === "knowledge"),
  );
  assert.equal(
    s.all(
      "SELECT * FROM node_sections WHERE section_id IN (?,?)",
      made.episodes[0].id,
      made.episodes[1].id,
    ).length,
    0,
  );
  s.close();
  const reopened = new Store(f.root);
  try {
    assert.equal(episodeDetail(reopened, p, "E0001").number, 2);
    assert.equal(
      preparationRecord(reopened, p, String(framework.id)).decision,
      "confirmed",
    );
    assert.deepEqual(reopened.all("PRAGMA foreign_key_check"), []);
  } finally {
    reopened.close();
  }
});
test("legacy writer delegation cannot bypass coordinator authorization", (t) => {
  const { s, p, writer } = fixture(t);
  const before = s.one("SELECT count(*) n FROM agents")!.n;
  assert.throws(
    () =>
      delegateWriting(s, p, {
        parentSessionId: writer,
        requestKey: randomUUID(),
        name: "分段整理",
        objective: "分析指定范围",
      }),
    /总控授权/,
  );
  assert.equal(s.one("SELECT count(*) n FROM agents")!.n, before);
});

test("invalid source or cross-project data rolls back an entire episode batch", (t) => {
  const f = fixture(t),
    { s, p, writer, coordinator, source } = f,
    { framework, confirmation } = confirmPlan(f);
  reviewPreparation(s, p, String(framework.id), {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    userMessageId: confirmation,
    reason: "确认",
  });
  const other = importStory(s, {
    source: "text",
    text: "另一个项目",
    importKey: randomUUID(),
  });
  assert.throws(
    () =>
      createEpisodes(s, p, {
        writerSessionId: writer,
        frameworkId: framework.id,
        requestKey: randomUUID(),
        units: [
          { name: "有效第一集", sources: [source] },
          { name: "错误第二集", sources: [{ storyId: other.story.id }] },
        ],
      }),
    /原始故事/,
  );
  assert.equal(listEpisodes(s, p).length, 0);
  assert.equal(
    workspace(s, p).sections.filter((row) => row.phase === "unit").length,
    0,
  );
  assert.throws(
    () =>
      readStoryRange(s, p, f.storyId, {
        startByte: 1,
        endByte: 4,
        encoding: "utf-8",
      }),
    /编码或字节边界/,
  );
  assert.throws(
    () =>
      readStoryRange(s, p, String(other.story.id), {
        startByte: 0,
        endByte: 3,
        encoding: "utf-8",
      }),
    /原始故事/,
  );
  assert.throws(
    () =>
      readStoryRange(s, p, f.storyId, {
        startByte: 0,
        endByte: 100000,
        encoding: "utf-8",
      }),
    /越界/,
  );
});
test("shared people and knowledge change only after coordinator review and preserve relationship phases", (t) => {
  const f = fixture(t),
    { s, p, analyst, writer, coordinator, source } = f;
  const proposed = proposeKnowledge(s, p, {
    authorSessionId: analyst,
    payload: {
      summary: "补充人物与关系",
      entities: [
        {
          code: "person_1",
          name: "林川",
          kind: "person",
          role: "目前的主要人物",
          sources: [source],
        },
        { code: "person_2", name: "青禾", kind: "person", sources: [source] },
      ],
      relations: [
        {
          code: "relation_early",
          from: "person_1",
          to: "person_2",
          label: "同行",
          period: "相遇阶段",
          sources: [source],
        },
      ],
    },
  });
  assert.equal(knowledge(s, p).entities.length, 0);
  assert.throws(
    () =>
      reviewKnowledge(s, p, proposed.id, {
        coordinatorSessionId: writer,
        decision: "confirmed",
        reason: "越过总控",
      }),
    /总控/,
  );
  reviewKnowledge(s, p, proposed.id, {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    reason: "依据明确",
  });
  assert.equal(knowledge(s, p).entities.length, 2);
  assert.equal(knowledge(s, p).relations.length, 1);
  const update = proposeKnowledge(s, p, {
    authorSessionId: analyst,
    payload: {
      summary: "后期关系变化",
      relations: [
        {
          code: "relation_later",
          from: "person_1",
          to: "person_2",
          label: "分离",
          period: "后期段落",
          sources: [source],
        },
      ],
    },
  });
  reviewKnowledge(s, p, update.id, {
    coordinatorSessionId: coordinator,
    decision: "confirmed",
    reason: "保留两个阶段",
  });
  assert.equal(knowledge(s, p).relations.length, 2);
  const stale = proposeKnowledge(s, p, {
    authorSessionId: analyst,
    payload: {
      summary: "旧版本增补",
      entities: [
        { code: "person_1", name: "林川", kind: "person", expectedRevision: 0 },
      ],
    },
  });
  assert.throws(
    () =>
      reviewKnowledge(s, p, stale.id, {
        coordinatorSessionId: coordinator,
        decision: "confirmed",
        reason: "检查冲突",
      }),
    /已更新/,
  );
  assert.equal(
    s.one("SELECT * FROM knowledge_reviews WHERE proposal_id=?", stale.id),
    undefined,
  );
});

test("large source ranges page without losing multibyte characters or altering the source", (t) => {
  const { s } = fixture(t);
  const text = "林🙂".repeat(Math.ceil(SOURCE_RANGE_MAX_BYTES / 7) + 5);
  const imported = importStory(s, {
    source: "text",
    text,
    importKey: randomUUID(),
  });
  const p = String(imported.project.id),
    storyId = String(imported.story.id);
  const endByte = Buffer.byteLength(text);
  const first = readStoryRange(s, p, storyId, {
    startByte: 0,
    endByte,
    encoding: "utf-8",
  });
  assert.equal(first.hasMore, true);
  assert.ok(first.endByte <= SOURCE_RANGE_MAX_BYTES);
  const second = readStoryRange(s, p, storyId, {
    startByte: first.endByte,
    endByte,
    encoding: "utf-8",
  });
  assert.equal(second.hasMore, false);
  assert.equal(second.endByte, endByte);
  assert.equal(first.text + second.text, text);
  assert.equal(storyFile(s, p, storyId).bytes.toString("utf8"), text);
});
