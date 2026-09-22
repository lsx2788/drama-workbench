import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import {
  SkillService,
  skillCatalogInstructions,
} from "../src/server/ai/skill-service";
import { PromptService } from "../src/server/ai/prompt-service";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import { defaultSkillFields } from "../src/domain/skills";
import type { Actor } from "../src/server/contracts";
import type { TaskKind } from "../src/domain/types";
import { SKILL_VERSION, seedSkills } from "../src/server/ai/skill-store";
import { toolsForRole } from "../src/server/ai/prompts";

function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-skills-")),
    db = new Database(root),
    studio = new StudioService(db),
    p = studio.create("技能测试", "测试用途", []);
  const skills = new SkillService(db),
    prompts = new PromptService(db);
  t.after(() => {
    db.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("drama-skills-"));
    rmSync(root, { recursive: true, force: true });
  });
  function run(actor: Actor, kind?: TaskKind) {
    const id = randomUUID();
    db.run(
      "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,?,?,?)",
      id,
      p,
      "completed",
      process.pid,
      new Date().toISOString(),
    );
    const layers = prompts.capture(p, id, actor, kind);
    db.run("UPDATE runs SET status='running',parent_id=? WHERE id=?", id, id);
    return { id, layers };
  }
  return { root, db, studio, p, skills, prompts, run };
}
test("skill packages seed immutable database content, expose only summaries and leave unrelated roles empty", (t) => {
  const { db, p, root, skills, run } = fixture(t);
  const items = skills.catalog(p, "assets");
  assert.equal(items.length, 10);
  assert.deepEqual(
    skills.catalog(p, "source").map((x) => x.id),
    ["source-analysis"],
  );
  assert.deepEqual(
    skills.catalog(p, "reviewer", "source").map((x) => x.id),
    ["source-analysis"],
  );
  assert.equal(skills.catalog(p, "reviewer", "assets").length, 10);
  const { id, layers } = run(
    { role: "executor", taskId: "image-test" },
    "assets",
  );
  const summary = skillCatalogInstructions(layers.skills);
  for (const item of items) {
    const detail = skills.detail(p, item.id);
    assert.equal(summary.includes(detail.resources["SKILL.md"]), false);
    assert.ok(detail.resources["review.md"]);
    const file = readFileSync(
      path.join("src/server/ai/skills", item.id, "SKILL.md"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.ok(file.trimEnd().endsWith(detail.resources["SKILL.md"]));
  }
  assert.deepEqual(skills.loads(p, id), []);
  const before = db.all("SELECT * FROM skill_documents");
  const reopened = new Database(root);
  reopened.close();
  assert.deepEqual(db.all("SELECT * FROM skill_documents"), before);
});
test("skill release upgrade appends new resources without changing custom settings or an active run catalog", (t) => {
  const { db, p, skills, run } = fixture(t);
  const oldVersion = "2026-09-21.1";
  db.run(
    "INSERT INTO skill_releases VALUES(?,?)",
    oldVersion,
    new Date().toISOString(),
  );
  db.run(
    "INSERT INTO skill_documents SELECT ?,skill_id,body FROM skill_documents WHERE version=? AND skill_id NOT IN ('drama-text-to-image','source-analysis','novel-adaptation','episode-planning','episode-writing','storyboard-design')",
    oldVersion,
    SKILL_VERSION,
  );
  db.run("UPDATE skill_selection SET version=? WHERE id=1", oldVersion);
  db.run("DELETE FROM skill_documents WHERE version=?", SKILL_VERSION);
  db.run("DELETE FROM skill_releases WHERE version=?", SKILL_VERSION);
  skills.save(p, "environment-props", 0, {
    ...defaultSkillFields(),
    enabled: false,
    instructions: "保持已经定稿的房间布局",
  });
  const old = run({ role: "executor", taskId: "old-image" }, "assets");
  const history = db.all(
    "SELECT * FROM skill_documents WHERE version=?",
    oldVersion,
  );
  const custom = db.all("SELECT * FROM project_skill_versions");
  const snapshot = db.one<any>(
    "SELECT layers FROM run_prompt_snapshots WHERE run_id=?",
    old.id,
  ).layers;
  seedSkills(db);
  assert.equal(skills.detail(p, "drama-text-to-image").version, SKILL_VERSION);
  assert.deepEqual(
    db.all("SELECT * FROM skill_documents WHERE version=?", oldVersion),
    history,
  );
  assert.deepEqual(db.all("SELECT * FROM project_skill_versions"), custom);
  assert.equal(
    db.one<any>(
      "SELECT layers FROM run_prompt_snapshots WHERE run_id=?",
      old.id,
    ).layers,
    snapshot,
  );
  assert.throws(
    () =>
      skills.load(p, old.id, { id: "drama-text-to-image", reason: "旧任务" }),
    /本轮未提供/,
  );
  assert.equal(
    skills.load(p, old.id, { id: "visual-style", reason: "原版本" }).version,
    oldVersion,
  );
  const next = run({ role: "executor", taskId: "new-image" }, "assets");
  const params = { id: "drama-text-to-image", reason: "室内定稿" };
  skills.load(p, next.id, params);
  skills.load(p, next.id, { ...params, reference: "references/interiors.md" });
  assert.deepEqual(
    skills
      .loads(p, next.id)
      .map((x) => x.section)
      .sort(),
    ["SKILL.md", "references/interiors.md"],
  );
  assert.equal(skills.detail(p, "environment-props").enabled, false);
  const before = db.all("SELECT * FROM skill_documents");
  seedSkills(db);
  assert.deepEqual(db.all("SELECT * FROM skill_documents"), before);
  // Re-selecting the old release must reuse the immutable published target.
  db.run("UPDATE skill_selection SET version=? WHERE id=1", oldVersion);
  seedSkills(db);
  assert.deepEqual(db.all("SELECT * FROM skill_documents"), before);
});

test("incomplete published skill release does not replace selection; unknown newer selections are preserved", (t) => {
  const { db } = fixture(t);
  db.run(
    "INSERT INTO skill_releases VALUES('2026-09-21.1',?)",
    new Date().toISOString(),
  );
  db.run("UPDATE skill_selection SET version='2026-09-21.1' WHERE id=1");
  const row = db.one<any>(
    "SELECT body FROM skill_documents WHERE version=? AND skill_id='drama-text-to-image'",
    SKILL_VERSION,
  );
  const broken = JSON.parse(row.body);
  delete broken.resources["references/vehicles.md"];
  db.run(
    "UPDATE skill_documents SET body=? WHERE version=? AND skill_id='drama-text-to-image'",
    JSON.stringify(broken),
    SKILL_VERSION,
  );
  assert.throws(() => seedSkills(db), /已发布 Skill 不完整/);
  assert.equal(
    db.one<any>("SELECT version FROM skill_selection").version,
    "2026-09-21.1",
  );
  db.run(
    "INSERT INTO skill_releases VALUES('future-release',?)",
    new Date().toISOString(),
  );
  db.run("UPDATE skill_selection SET version='future-release'");
  const before = db.all("SELECT * FROM skill_documents");
  seedSkills(db);
  assert.equal(
    db.one<any>("SELECT version FROM skill_selection").version,
    "future-release",
  );
  assert.deepEqual(db.all("SELECT * FROM skill_documents"), before);
});
test("production/review content and references are selected separately; forged paths, roles and projects cannot read", (t) => {
  const { studio, p, db, skills, run } = fixture(t);
  const production = run({ role: "executor", taskId: "image-test" }, "assets"),
    review = run({ role: "reviewer", taskId: "image-test" }, "assets");
  const source = run({ role: "executor", taskId: "source" }, "source");
  const params = { id: "visual-style", reason: "现代卡通人物" };
  assert.throws(() => skills.load(p, source.id, params), /本轮未提供/);
  assert.throws(
    () => skills.load(studio.create("另一个", "", []), production.id, params),
    /当前执行/,
  );
  assert.throws(() =>
    skills.load(p, production.id, { ...params, id: "../assets" }),
  );
  assert.throws(
    () =>
      skills.load(p, production.id, {
        ...params,
        reference: "../../rules/system.md",
      }),
    /目录/,
  );
  assert.throws(
    () =>
      skills.load(p, production.id, {
        ...params,
        reference: "references/animation.md",
      }),
    /先读取/,
  );
  const made = skills.load(p, production.id, params),
    checked = skills.load(p, review.id, params);
  assert.equal(made.section, "SKILL.md");
  assert.equal(checked.section, "review.md");
  assert.notEqual(made.body, checked.body);
  assert.throws(
    () => skills.load(p, review.id, { ...params, reference: "SKILL.md" }),
    /目录/,
  );
  skills.load(p, production.id, {
    ...params,
    reference: "references/animation.md",
  });
  assert.deepEqual(
    skills
      .loads(p, production.id)
      .map((x) => x.section)
      .sort(),
    ["SKILL.md", "references/animation.md"],
  );
  assert.deepEqual(
    skills.load(p, production.id, { ...params, reason: "重复读取" }),
    made,
  );
  assert.equal(skills.loads(p, production.id).length, 2);
  db.run("UPDATE runs SET status='completed' WHERE id=?", production.id);
  assert.throws(() => skills.load(p, production.id, params), /当前执行/);
});
test("custom revisions and release are pinned before first load; later updates, disable and restore preserve history", (t) => {
  const { p, db, skills, run, prompts } = fixture(t);
  const fields = {
    ...defaultSkillFields(),
    instructions: "此剧角色采用既定三维比例",
    review: "核对既定三维比例",
  };
  assert.equal(skills.save(p, "face-expression", 0, fields), 1);
  assert.equal(skills.save(p, "face-expression", 0, fields), 1);
  const old = run({ role: "executor", taskId: "image-test" }, "assets");
  const snapshot = db.one<any>(
    "SELECT layers FROM run_prompt_snapshots WHERE run_id=?",
    old.id,
  ).layers;
  skills.save(p, "face-expression", 1, {
    ...fields,
    enabled: false,
    instructions: "后来的补充",
  });
  assert.throws(
    () => skills.save(p, "face-expression", 1, defaultSkillFields()),
    /别处更新/,
  );
  const newer = run({ role: "executor", taskId: "image-test" }, "assets");
  assert.throws(
    () => skills.load(p, newer.id, { id: "face-expression", reason: "测试" }),
    /本轮未提供/,
  );
  // A new system release is published after the old run has already captured its catalog.
  db.run(
    "INSERT INTO skill_releases VALUES('test-next',?)",
    new Date().toISOString(),
  );
  for (const row of db.all<any>(
    "SELECT * FROM skill_documents WHERE version=?",
    SKILL_VERSION,
  )) {
    const doc = JSON.parse(row.body);
    doc.resources["SKILL.md"] += "\n新系统规则仅下一轮";
    db.run(
      "INSERT INTO skill_documents VALUES('test-next',?,?)",
      row.skill_id,
      JSON.stringify(doc),
    );
  }
  db.run("UPDATE skill_selection SET version='test-next' WHERE id=1");
  const loaded = skills.load(p, old.id, {
    id: "face-expression",
    reason: "本轮面部任务",
  });
  assert.equal(loaded.version, SKILL_VERSION);
  assert.equal(loaded.customRevision, 1);
  assert.match(loaded.body, /此剧角色采用既定三维比例/);
  assert.doesNotMatch(
    loaded.body,
    /后来的补充|新系统规则仅下一轮|核对既定三维比例/,
  );
  assert.equal(
    db.one<any>(
      "SELECT layers FROM run_prompt_snapshots WHERE run_id=?",
      old.id,
    ).layers,
    snapshot,
  );
  skills.save(
    p,
    "face-expression",
    2,
    skills.custom(p, "face-expression", 1).fields,
  );
  const review = run({ role: "reviewer", taskId: "image-test" }, "assets");
  const reviewLoad = skills.load(p, review.id, {
    id: "face-expression",
    reason: "复审",
  });
  assert.equal(reviewLoad.version, "test-next");
  assert.equal(reviewLoad.customRevision, 3);
  assert.match(reviewLoad.body, /核对既定三维比例/);
  assert.doesNotMatch(reviewLoad.body, /此剧角色采用既定三维比例/);
  assert.deepEqual(prompts.execution(p, old.id).skillLoads, [loaded]);
});
test("writing catalogs, tool grants and reviewer loads stay within the node responsibility", (t) => {
  const { db, p, skills, run, prompts } = fixture(t);
  const expected = {
    source: ["source-analysis"],
    script: ["episode-planning", "novel-adaptation"],
    episode: ["episode-writing"],
  } as const;
  for (const key of ["source", "script", "episode"] as const) {
    assert.deepEqual(
      skills.catalog(p, key).map((x) => x.id),
      expected[key],
    );
    assert.deepEqual(
      skills.catalog(p, "reviewer", key).map((x) => x.id),
      expected[key],
    );
    assert.ok(toolsForRole("executor", key).includes("read_skill"));
    assert.ok(!toolsForRole("executor", key).includes("generate_image"));
    const producer = run({ role: "executor", taskId: key }, key);
    const reviewer = run({ role: "reviewer", taskId: key }, key);
    for (const id of expected[key]) {
      assert.equal(skills.detail(p, id).id, id);
      assert.ok(
        prompts
          .settings(p, key)
          .layers.tools.some((x) => x.id === "read_skill"),
      );
      assert.equal(
        skills.load(p, producer.id, { id, reason: "当前职责" }).mode,
        "production",
      );
      const reviewed = skills.load(p, reviewer.id, { id, reason: "节点审核" });
      assert.equal(reviewed.section, "review.md");
      assert.equal(reviewed.mode, "review");
    }
    assert.throws(
      () =>
        skills.load(p, producer.id, {
          id: "storyboard-design",
          reason: "尝试越权",
        }),
      /本轮未提供/,
    );
    assert.throws(
      () =>
        skills.load(p, reviewer.id, {
          id: "drama-text-to-image",
          reason: "不相关审核",
        }),
      /本轮未提供/,
    );
  }
  assert.equal(
    skills.catalog(p, "assets").some((x) => x.id === "novel-adaptation"),
    false,
  );
  for (const kind of ["storyboard", "board"] as const) {
    const reviewer = run({ role: "reviewer", taskId: "shot" }, kind);
    assert.ok(
      reviewer.layers.skills?.some((x) => x.id === "storyboard-design"),
    );
    assert.ok(toolsForRole("reviewer", kind).includes("read_skill"));
    assert.equal(
      skills.load(p, reviewer.id, {
        id: "storyboard-design",
        reason: "审核镜头",
      }).section,
      "review.md",
    );
  }
  const board = run({ role: "executor", taskId: "board" }, "storyboard");
  skills.load(p, board.id, { id: "storyboard-design", reason: "按剧本拆镜" });
  skills.load(p, board.id, {
    id: "storyboard-design",
    reference: "references/coverage-continuity.md",
    reason: "镜间连续性",
  });
  assert.equal(skills.loads(p, board.id).length, 2);
  assert.ok(!toolsForRole("executor", "storyboard").includes("generate_image"));
  const coordinator = run({ role: "coordinator" });
  assert.equal(coordinator.layers.skills?.length, 15);
  assert.equal(
    skills.load(p, coordinator.id, {
      id: "novel-adaptation",
      reason: "最终验收",
    }).section,
    "review.md",
  );
  assert.deepEqual(skills.catalog(p, "reviewer", "video"), []);
  assert.equal(
    db.one<any>(
      "SELECT count(*) n FROM skill_documents WHERE version=?",
      SKILL_VERSION,
    ).n,
    15,
  );
});

test("upgrade from image-only .2 freezes old source runs and preserves custom revisions", (t) => {
  const { db, p, skills, run } = fixture(t);
  const imageDocs = skills.catalog(p, "assets").map((x) => x.id);
  db.run(
    "INSERT INTO skill_releases VALUES('2026-09-21.2',?)",
    new Date().toISOString(),
  );
  for (const id of imageDocs) {
    const doc = JSON.parse(
      db.one<any>(
        "SELECT body FROM skill_documents WHERE version=? AND skill_id=?",
        SKILL_VERSION,
        id,
      ).body,
    );
    delete doc.scope;
    db.run(
      "INSERT INTO skill_documents VALUES('2026-09-21.2',?,?)",
      id,
      JSON.stringify(doc),
    );
  }
  db.run("UPDATE skill_selection SET version='2026-09-21.2'");
  db.run("DELETE FROM skill_documents WHERE version=?", SKILL_VERSION);
  db.run("DELETE FROM skill_releases WHERE version=?", SKILL_VERSION);
  skills.save(p, "visual-style", 0, {
    ...defaultSkillFields(),
    instructions: "沿用原定风格",
  });
  const old = run({ role: "executor", taskId: "source" }, "source");
  assert.deepEqual(old.layers.skills, []);
  const snapshot = db.one<any>(
    "SELECT layers FROM run_prompt_snapshots WHERE run_id=?",
    old.id,
  ).layers;
  const history = db.all("SELECT * FROM skill_documents");
  seedSkills(db);
  assert.deepEqual(
    db.all("SELECT * FROM skill_documents WHERE version='2026-09-21.2'"),
    history,
  );
  assert.equal(skills.detail(p, "visual-style").customRevision, 1);
  assert.equal(
    db.one<any>(
      "SELECT layers FROM run_prompt_snapshots WHERE run_id=?",
      old.id,
    ).layers,
    snapshot,
  );
  assert.throws(
    () =>
      skills.load(p, old.id, {
        id: "source-analysis",
        reason: "新技能不注入旧执行",
      }),
    /本轮未提供/,
  );
  const fresh = run({ role: "executor", taskId: "source" }, "source");
  assert.equal(
    skills.load(p, fresh.id, { id: "source-analysis", reason: "整理原作" })
      .version,
    SKILL_VERSION,
  );
});

test("runtime offers read_skill, returns persisted content on demand and does not preload full skills", async (t) => {
  const { p, db, studio, skills, prompts } = fixture(t);
  let connection!: AiConnection,
    started = false;
  const runtime = new AiRuntime(
    studio,
    () =>
      (connection = {
        notices: new Set(),
        onRequest: async () => ({}),
        initialize: async () => {},
        close: () => {},
        request: async (method, args: any = {}) => {
          if (method === "account/read")
            return { account: { type: "chatgpt" } };
          if (method === "model/list")
            return { data: [{ isDefault: true, model: "test" }] };
          if (method === "mcpServerStatus/list") return { data: [] };
          if (method === "thread/start") {
            assert.ok(
              args.dynamicTools.some((tool: any) => tool.name === "read_skill"),
            );
            assert.ok(args.baseInstructions.includes("face-expression"));
            assert.equal(
              args.baseInstructions.includes(
                skills.detail(p, "face-expression").resources["review.md"],
              ),
              false,
            );
            started = true;
            return { thread: { id: "skill-test" } };
          }
          if (method === "turn/start") {
            assert.ok(started);
            const result: any = await connection.onRequest("item/tool/call", {
              threadId: "skill-test",
              tool: "read_skill",
              callId: "skill-call",
              arguments: { id: "face-expression", reason: "核对当前面部意见" },
            });
            assert.equal(result.success, true);
            assert.equal(
              JSON.parse(result.contentItems[0].text).mode,
              "review",
            );
            for (const notice of connection.notices)
              notice("turn/completed", {
                threadId: "skill-test",
                turn: { status: "completed" },
              });
            return { turn: { id: "turn-skill" } };
          }
          return {};
        },
      }),
  );
  const queued = runtime.queue(p, "请看面部意见", randomUUID());
  await runtime.start(queued.id);
  assert.equal(
    db.one<any>("SELECT status FROM runs WHERE id=?", queued.id).status,
    "completed",
  );
  assert.equal(prompts.execution(p, queued.id).skillLoads?.length, 1);
  assert.equal(
    db.one<any>(
      "SELECT count(*) n FROM raw_events WHERE run_id=? AND kind='tool_call'",
      queued.id,
    ).n,
    1,
  );
});
