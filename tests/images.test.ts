import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { AiRuntime, type AiConnection } from "../src/server/ai/runtime";
import { ImageService, imageSchema } from "../src/server/ai/images";
import { decodeGeneratedImage } from "../src/server/ai/image-provider";
import { readMaterial } from "../src/server/files";
import type { RpcData } from "../src/server/ai/codex-rpc";
import { NodePipeline, NodeBatchYield } from "../src/server/ai/node-pipeline";
import { toolsForRole } from "../src/server/ai/prompts";
import { PromptService } from "../src/server/ai/prompt-service";
import { characterReadiness } from "../src/server/character-kit";

test("front-view identity is an independent basis; wardrobe waits for an approved turnaround and supplements can be accepted by their reviewer", async (t) => {
  const { s, p, run } = fixture(t);
  const images = new ImageService(s, async () => decodeGeneratedImage(png));
  const frontSpec = imageSchema.parse({
    ...args,
    name: "主角正面定稿",
    category: "人物",
    purpose: "角色正面图",
  });
  const front = images.task(p, frontSpec, "front-basis");
  const frontImage = await images.generate(
    p,
    front,
    { ...frontSpec, revision: 0 },
    { role: "executor", taskId: front },
    run(),
    "front",
  );
  const threeSpec = imageSchema.parse({
    ...frontSpec,
    purpose: "角色三视图",
    name: "主角三视图",
    basisTaskId: front,
  });
  assert.throws(() => images.task(p, threeSpec, "too-early"), /已由总控验收/);
  s.act(
    p,
    front,
    { type: "review" },
    { role: "reviewer", taskId: front },
    1,
    "实际看图确定人物身份",
  );
  assert.equal(
    s.acceptReviewedImage(p, front, 1),
    false,
    "initial identity cannot self-approve",
  );
  s.act(p, front, { type: "accept" }, { role: "coordinator" }, 1, "人物已确定");
  const outfitSpec = imageSchema.parse({
    ...frontSpec,
    purpose: "服装图",
    name: "独立服装",
    category: "道具",
    basisTaskId: front,
  });
  assert.throws(
    () => images.task(p, outfitSpec, "early-outfit"),
    /先完成并验收同一角色的三视图/,
  );
  assert.throws(
    () => images.task(p, { ...frontSpec, basisTaskId: front }, "fake-front"),
    /不附属于另一个首样/,
  );
  const three = images.task(p, threeSpec, "turnaround");
  const threeImage = await images.generate(
    p,
    three,
    { ...threeSpec, revision: 0 },
    { role: "executor", taskId: three },
    run(),
    "three",
  );
  assert.throws(
    () => images.task(p, outfitSpec, "unreviewed-outfit"),
    /三视图/,
  );
  s.act(
    p,
    three,
    { type: "review" },
    { role: "reviewer", taskId: three },
    1,
    "同一人物正侧背已核验",
  );
  assert.equal(s.acceptReviewedImage(p, three, 1), true);
  const outfit = images.task(p, outfitSpec, "wardrobe");
  const outfitImage = await images.generate(
    p,
    outfit,
    { ...outfitSpec, revision: 0 },
    { role: "executor", taskId: outfit },
    run(),
    "outfit",
  );
  s.act(
    p,
    outfit,
    { type: "review" },
    { role: "reviewer", taskId: outfit },
    1,
    "已检查实际服装图",
  );
  assert.equal(s.acceptReviewedImage(p, outfit, 1), true);
  const comboSpec = imageSchema.parse({
    ...frontSpec,
    purpose: "穿衣组合",
    name: "正式穿衣",
    basisTaskId: front,
    referenceFileIds: [frontImage.fileId, outfitImage.fileId],
  });
  assert.throws(
    () => images.task(p, comboSpec, "skip-three"),
    /白色素衣基础图或三视图/,
  );
  const validCombo = {
    ...comboSpec,
    referenceFileIds: [threeImage.fileId, outfitImage.fileId],
  };
  const combo = images.task(p, validCombo, "combined");
  await images.generate(
    p,
    combo,
    { ...validCombo, revision: 0 },
    { role: "executor", taskId: combo },
    run(),
    "combine",
  );
  assert.equal(characterReadiness(s, p, combo)[0].basisTaskId, front);
  s.act(
    p,
    three,
    { type: "return", reason: "比例待修正" },
    { role: "human" },
    1,
    "比例待修正",
  );
  assert.throws(
    () => images.task(p, { ...outfitSpec, name: "第二套服装" }, "stale-three"),
    /三视图/,
  );
});

test("character kit blocks package review and frame generation until real approved supplements exist", async (t) => {
  const { s, p, run, db } = fixture(t);
  let calls = 0;
  const images = new ImageService(s, async () => {
    calls++;
    return decodeGeneratedImage(png);
  });
  async function create(
    purpose: "穿衣首样" | "角色三视图" | "面部特写" | "服装图" | "穿衣组合",
    name: string,
    basisTaskId?: string,
    referenceFileIds: string[] = [],
  ) {
    const spec = imageSchema.parse({
      ...args,
      purpose,
      name,
      category: purpose === "服装图" ? "道具" : "人物",
      basisTaskId,
      referenceFileIds,
    });
    const id = images.task(p, spec, name);
    const out = await images.generate(
      p,
      id,
      { ...spec, revision: 0 },
      { role: "executor", taskId: id },
      run(),
      name,
    );
    return { id, fileId: out.fileId };
  }
  function accept(id: string) {
    s.act(
      p,
      id,
      { type: "review" },
      { role: "reviewer", taskId: id },
      1,
      "已查看实际图片",
    );
    s.act(
      p,
      id,
      { type: "accept" },
      { role: "coordinator" },
      1,
      "符合角色用途",
    );
  }
  const basis = await create("穿衣首样", "主角首样");
  accept(basis.id);
  const other = await create("穿衣首样", "其他角色");
  accept(other.id);
  // Historical visual provenance must not require a second kit for an obsolete sample.
  db.run(
    "UPDATE outputs SET asset_ids=? WHERE project_id=? AND task_id=?",
    JSON.stringify([
      s.project(p).assets.find((a) => a.taskId === other.id)!.id,
    ]),
    p,
    basis.id,
  );
  for (const [id, kind] of [
    ["kit-package", "assets"],
    ["kit-frame", "frames"],
  ])
    db.run(
      "INSERT INTO tasks(project_id,id,kind,title,objective,enabled,review_enabled) VALUES(?,?,?,?,?,1,1)",
      p,
      id,
      kind,
      id,
      id,
    );
  db.run(
    "INSERT INTO dependencies VALUES(?,?,?)",
    p,
    "kit-frame",
    "kit-package",
  );
  s.act(
    p,
    "kit-package",
    {
      type: "save",
      text: "首样不能代替完整资产",
      assetIds: [s.project(p).assets.find((a) => a.taskId === basis.id)!.id],
      reuseReason: "已查当前首样",
    },
    { role: "executor", taskId: "kit-package" },
    0,
  );
  assert.deepEqual(characterReadiness(s, p, "kit-package")[0].missing, [
    "角色三视图",
    "面部特写",
    "服装图",
    "穿衣组合",
  ]);
  assert.throws(
    () =>
      s.act(
        p,
        "kit-package",
        { type: "review" },
        { role: "reviewer", taskId: "kit-package" },
        1,
        "检查",
      ),
    /角色规范图尚未齐备/,
  );
  assert.throws(
    () =>
      s.act(
        p,
        "kit-package",
        { type: "accept" },
        { role: "coordinator" },
        1,
        "检查",
      ),
    /角色规范图尚未齐备/,
  );
  const frameArgs = {
    ...args,
    taskId: "kit-frame",
    referenceFileIds: [basis.fileId],
    revision: 0,
  };
  const before = calls;
  await assert.rejects(
    images.generate(
      p,
      "kit-frame",
      frameArgs,
      { role: "executor", taskId: "kit-frame" },
      run(),
      "blocked",
    ),
    /角色规范图尚未齐备/,
  );
  assert.equal(calls, before);
  const base = await create("角色三视图", "主角基础", basis.id);
  accept(base.id);
  const face = await create("面部特写", "主角面部", basis.id);
  accept(face.id);
  const outfit = await create("服装图", "主角服装", basis.id);
  accept(outfit.id);
  const combo = await create("穿衣组合", "主角穿衣", basis.id, [
    base.fileId,
    outfit.fileId,
  ]);
  assert.deepEqual(characterReadiness(s, p, "kit-frame")[0].missing, [
    "穿衣组合",
  ]);
  accept(combo.id);
  assert.equal(
    characterReadiness(s, p, "kit-frame").length,
    1,
    "unused other character must not block this branch",
  );
  assert.equal(characterReadiness(s, p, "kit-frame")[0].ready, true);
  db.run(
    "INSERT INTO image_trash VALUES(?,?,?,?,?)",
    face.fileId,
    "过期测试",
    "human",
    null,
    new Date().toISOString(),
  );
  assert.deepEqual(characterReadiness(s, p, "kit-frame")[0].missing, [
    "面部特写",
  ]);
  db.run("DELETE FROM image_trash WHERE file_id=?", face.fileId);
  s.act(
    p,
    "kit-package",
    { type: "review" },
    { role: "reviewer", taskId: "kit-package" },
    1,
    "完整性检查通过",
  );
  s.act(
    p,
    "kit-package",
    { type: "accept" },
    { role: "coordinator" },
    1,
    "已齐备",
  );
  await images.generate(
    p,
    "kit-frame",
    { ...frameArgs, referenceFileIds: [combo.fileId] },
    { role: "executor", taskId: "kit-frame" },
    run(),
    "ready",
  );
  s.act(
    p,
    face.id,
    { type: "return", reason: "面部需修正" },
    { role: "human" },
    1,
    "用户修正",
  );
  assert.deepEqual(characterReadiness(s, p, "kit-frame")[0].missing, [
    "面部特写",
  ]);
  assert.throws(
    () =>
      s.act(
        p,
        "kit-frame",
        { type: "review" },
        { role: "reviewer", taskId: "kit-frame" },
        1,
        "检查",
      ),
    /面部特写/,
  );
});

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const args = imageSchema.parse({
  prompt: "一片绿色叶子，白色背景",
  name: "叶子",
  category: "道具",
  reuseReason: "已查询，没有适用资产",
});

test("returned images allow a revised descriptive name while preserving asset identity, history and category", async (t) => {
  const { s, p, run } = fixture(t);
  let calls = 0;
  const images = new ImageService(s, async () => {
    calls++;
    return decodeGeneratedImage(png);
  });
  const id = images.task(p, args, "revision-label"),
    actor = { role: "executor" as const, taskId: id };
  const original = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    actor,
    run(),
    "first",
  );
  await assert.rejects(
    images.generate(
      p,
      id,
      { ...args, name: "轻盈叶片", revision: 1 },
      actor,
      run(),
      "draft-rename",
    ),
    /同一资产/,
  );
  s.act(
    p,
    id,
    { type: "review" },
    { role: "reviewer", taskId: id },
    1,
    "完成内部审核",
  );
  s.act(
    p,
    id,
    { type: "return", reason: "调整叶片形态" },
    { role: "coordinator" },
    1,
    "调整叶片形态",
  );
  await assert.rejects(
    images.generate(
      p,
      id,
      { ...args, category: "场景", name: "森林", revision: 1 },
      actor,
      run(),
      "wrong-category",
    ),
    /资产类别/,
  );
  const revision = await images.generate(
    p,
    id,
    { ...args, name: "轻盈叶片", revision: 1 },
    actor,
    run(),
    "revised",
  );
  assert.equal(calls, 2);
  assert.equal(revision.revision, 2);
  assert.equal(s.project(p).tasks[id].assetName, "叶子");
  assert.equal(s.outputFiles(p, id, 1)[0].id, original.fileId);
  assert.equal(s.outputFiles(p, id, 2)[0].id, revision.fileId);
  assert.equal(s.project(p).tasks[id].delivery, "draft");
});

test("coordinator can resubmit an unchanged rejected image for independent review without new versions or approval", async (t) => {
  const { s, p, run, db } = fixture(t);
  const images = new ImageService(s, async () => decodeGeneratedImage(png));
  const id = images.task(p, args, "re-review");
  const image = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run(),
    "image",
  );
  s.act(
    p,
    id,
    { type: "return", reason: "缺授权原文" },
    { role: "reviewer", taskId: id },
    1,
    "缺授权原文",
  );
  const action = {
    type: "request-review" as const,
    reason: "已补齐原有用户授权及新审核依据",
  };
  assert.throws(
    () => s.act(p, id, action, { role: "executor", taskId: id }, 1),
    /制作 AI/,
  );
  assert.throws(
    () => s.act(p, id, action, { role: "reviewer", taskId: id }, 1),
    /审核 AI|待审核版本/,
  );
  assert.throws(() => s.act(p, id, action, { role: "coordinator" }, 0), /版本/);
  s.act(p, id, action, { role: "coordinator" }, 1);
  assert.equal(s.project(p).tasks[id].revision, 1);
  assert.equal(s.project(p).tasks[id].delivery, "draft");
  assert.equal(s.outputFiles(p, id, 1)[0].id, image.fileId);
  assert.equal(
    db.one<any>(
      "SELECT COUNT(*) n FROM outputs WHERE project_id=? AND task_id=?",
      p,
      id,
    ).n,
    1,
  );
  assert.throws(
    () =>
      s.act(
        p,
        id,
        { type: "accept" },
        { role: "coordinator" },
        1,
        "尝试提前验收",
      ),
    /内部审核/,
  );
  const pipeline = new NodePipeline(s),
    job = pipeline.start(p, id, "使用补齐依据，仅复审原图", run());
  const actors: string[] = [];
  await pipeline.drive(p, job, "仅复审", async (actor) => {
    actors.push(actor.role);
    s.act(p, id, { type: "review" }, actor, 1, "依据已补齐，已核对内容");
    return "";
  });
  assert.deepEqual(actors, ["reviewer"]);
  assert.equal(s.project(p).tasks[id].delivery, "reviewed");
});

test("answering an escalated evidence question can route the same rejected image directly to its reviewer", async (t) => {
  const { s, p, run } = fixture(t),
    pipeline = new NodePipeline(s);
  const images = new ImageService(s, async () => decodeGeneratedImage(png));
  const id = images.task(p, args, "evidence-review"),
    parent = run();
  const job = pipeline.start(p, id, "制作", parent);
  const file = await images.generate(
    p,
    id,
    { ...args, revision: 0 },
    { role: "executor", taskId: id },
    run(),
    "first",
  );
  s.act(
    p,
    id,
    { type: "return", reason: "授权依据缺失" },
    { role: "reviewer", taskId: id },
    1,
    "授权依据缺失",
  );
  const q = pipeline.question(
    p,
    job,
    { role: "executor", taskId: id },
    "请补审核依据",
  );
  pipeline.decide(
    p,
    job,
    { role: "reviewer", taskId: id },
    q.questionId,
    true,
    "需要原确认",
  );
  await pipeline.drive(p, job, "", async () => "");
  const resumed = pipeline.answer(
    p,
    q.questionId,
    "已补真实确认，请只复审当前图片",
    parent,
    true,
  );
  const roles: string[] = [];
  await pipeline.drive(p, job, resumed.instruction, async (actor) => {
    roles.push(actor.role);
    s.act(p, id, { type: "review" }, actor, 1, "核对补充依据与实际图片后通过");
    return "";
  });
  assert.deepEqual(roles, ["reviewer"]);
  assert.equal(s.project(p).tasks[id].revision, 1);
  assert.equal(s.project(p).tasks[id].delivery, "reviewed");
  assert.equal(s.outputFiles(p, id, 1)[0].id, file.fileId);
});

test("storyboard and writing roles cannot generate images; settings match actual tool grants", (t) => {
  const { db, p } = fixture(t),
    prompts = new PromptService(db);
  for (const kind of ["source", "script", "episode", "storyboard", "board"]) {
    assert.equal(
      toolsForRole("executor", kind).includes("generate_image"),
      false,
    );
  }
  for (const key of [
    "source",
    "script",
    "episode",
    "board",
    "reviewer",
  ] as const) {
    assert.equal(
      prompts
        .settings(p, key)
        .layers.tools.some((t) => t.id === "generate_image"),
      false,
    );
  }
  for (const kind of ["assets", "frames"]) {
    assert.equal(
      toolsForRole("executor", kind).includes("generate_image"),
      true,
    );
  }
  assert.equal(toolsForRole("coordinator").includes("generate_image"), true);
});

test("character expansion waits for an accepted dressed sample, injects its image and persists purpose", async (t) => {
  const { db, s, p, run } = fixture(t);
  const requests: any[] = [];
  const images = new ImageService(s, async (request) => {
    requests.push(request);
    return decodeGeneratedImage(png);
  });
  const sample = {
    ...args,
    name: "主角日常造型",
    category: "人物" as const,
    purpose: "穿衣首样" as const,
  };
  const id = images.task(p, sample, "sample"),
    actor = { role: "executor" as const, taskId: id };
  const spec = {
    ...sample,
    name: "主角三视图",
    purpose: "角色三视图" as const,
    basisTaskId: id,
  };
  const count = () => Object.keys(s.project(p).tasks).length,
    before = count();
  assert.throws(
    () => images.task(p, { ...spec, basisTaskId: undefined }, "missing"),
    /首样/,
  );
  assert.throws(() => images.task(p, spec, "early"), /总控验收/);
  assert.equal(count(), before);
  const first = await images.generate(
    p,
    id,
    { ...sample, revision: 0 },
    actor,
    run(),
    "sample",
  );
  assert.equal(requests[0].layout, "single");
  assert.match(requests[0].prompt, /不要三视图/);
  s.act(
    p,
    id,
    { type: "review" },
    { role: "reviewer", taskId: id },
    1,
    "符合首样要求",
  );
  assert.throws(() => images.task(p, spec, "reviewed-only"), /总控验收/);
  s.act(p, id, { type: "accept" }, { role: "coordinator" }, 1, "整体方向合适");
  const derivative = images.task(p, spec, "turnaround");
  assert.deepEqual(s.project(p).tasks[derivative].dependencies, [id]);
  await images.generate(
    p,
    derivative,
    { ...spec, revision: 0 },
    { role: "executor", taskId: derivative },
    run(),
    "views",
  );
  assert.equal(requests[1].layout, "turnaround");
  assert.equal(requests[1].references.length, 1);
  assert.equal(
    requests[1].references[0],
    ((await readMaterial(db, p, first.fileId)) as any).url,
  );
  assert.match(requests[1].prompt, /禁止混合/);
  assert.match(requests[1].prompt, /不附加其他图种/);
  assert.match(requests[1].prompt, /白色素衣/);
  assert.match(requests[1].prompt, /A-pose/);
  assert.match(requests[1].prompt, /不要宽袍、裙子/);
  assert.match(requests[1].prompt, /不要沿用首样剧情服装/);
  await assert.rejects(
    images.generate(
      p,
      derivative,
      { ...spec, purpose: "穿衣首样", basisTaskId: undefined, revision: 1 },
      { role: "executor", taskId: derivative },
      run(),
      "bypass",
    ),
    /用途或首样/,
  );
  const other = s.create("其他剧本", "", []);
  assert.throws(() => images.task(other, spec, "alien"), /本剧本/);
  const reopened = new Database(db.root);
  try {
    assert.deepEqual(
      {
        ...reopened.one<{ purpose: string; basis_task_id: string }>(
          "SELECT purpose,basis_task_id FROM image_task_specs WHERE task_id=?",
          derivative,
        ),
      },
      { purpose: "角色三视图", basis_task_id: id },
    );
  } finally {
    reopened.close();
  }
});

test("dressed composites require accepted character basics and a separate outfit", async (t) => {
  const { s, p, run } = fixture(t);
  const requests: any[] = [];
  const images = new ImageService(s, async (request) => {
    requests.push(request);
    return decodeGeneratedImage(png);
  });
  async function create(
    spec: ReturnType<typeof imageSchema.parse>,
    key: string,
  ) {
    const id = images.task(p, spec, key);
    const output = await images.generate(
      p,
      id,
      { ...spec, revision: 0 },
      { role: "executor", taskId: id },
      run(),
      key,
    );
    return { id, fileId: output.fileId };
  }
  function accept(id: string) {
    s.act(
      p,
      id,
      { type: "review" },
      { role: "reviewer", taskId: id },
      1,
      "已查看图片",
    );
    s.act(p, id, { type: "accept" }, { role: "coordinator" }, 1, "符合用途");
  }
  const sample = await create(
    { ...args, name: "角色首样", category: "人物", purpose: "穿衣首样" },
    "sample",
  );
  accept(sample.id);
  const base = await create(
    {
      ...args,
      name: "白色素衣三视图",
      category: "人物",
      purpose: "角色三视图",
      basisTaskId: sample.id,
    },
    "base",
  );
  const outfit = await create(
    { ...args, name: "鹅黄外衫", purpose: "服装图", basisTaskId: sample.id },
    "outfit",
  );
  const combo = {
    ...args,
    name: "组合穿衣图",
    category: "人物" as const,
    purpose: "穿衣组合" as const,
    basisTaskId: sample.id,
    referenceFileIds: [base.fileId, outfit.fileId],
  };
  assert.throws(() => images.task(p, combo, "unapproved"), /白色素衣/);
  accept(base.id);
  assert.throws(() => images.task(p, combo, "outfit-unapproved"), /独立服装图/);
  accept(outfit.id);
  assert.throws(
    () =>
      images.task(
        p,
        { ...combo, referenceFileIds: [sample.fileId, outfit.fileId] },
        "sample-only",
      ),
    /白色素衣/,
  );
  assert.throws(
    () =>
      images.task(
        p,
        { ...combo, referenceFileIds: [base.fileId] },
        "no-outfit",
      ),
    /独立服装图/,
  );
  const other = await create(
    { ...args, name: "另一个角色", category: "人物", purpose: "穿衣首样" },
    "other",
  );
  accept(other.id);
  assert.throws(
    () =>
      images.task(p, { ...combo, basisTaskId: other.id }, "wrong-character"),
    /同一角色/,
  );
  await create(combo, "composite");
  const request = requests.at(-1);
  assert.equal(request.references.length, 3);
  assert.equal(request.layout, "single");
  assert.match(request.prompt, /白色素衣被目标服装替换/);
});

test("existing accepted character images may serve as samples, descriptions and prop images may not", async (t) => {
  const { db, s, p, run } = fixture(t),
    images = new ImageService(s, async () => decodeGeneratedImage(png));
  const sample = {
    ...args,
    name: "角色首样",
    category: "人物" as const,
    purpose: "穿衣首样" as const,
  };
  const id = images.task(p, sample, "sample"),
    actor = { role: "executor" as const, taskId: id };
  assert.throws(
    () => images.task(p, { ...sample, purpose: "单图" }, "unspecified"),
    /角色图片需指定/,
  );
  await images.generate(
    p,
    id,
    { ...sample, revision: 0 },
    actor,
    run(),
    "sample",
  );
  s.act(
    p,
    id,
    { type: "review" },
    { role: "reviewer", taskId: id },
    1,
    "已看图",
  );
  s.act(p, id, { type: "accept" }, { role: "coordinator" }, 1, "通过");
  db.run(
    "DELETE FROM image_task_specs WHERE project_id=? AND task_id=?",
    p,
    id,
  );
  const reused = images.task(
    p,
    { ...sample, name: "脸部", purpose: "面部特写", basisTaskId: id },
    "legacy",
  );
  assert.ok(reused);
  const prop = images.task(p, args, "prop");
  await images.generate(
    p,
    prop,
    { ...args, revision: 0 },
    { role: "executor", taskId: prop },
    run(),
    "prop",
  );
  s.act(
    p,
    prop,
    { type: "review" },
    { role: "reviewer", taskId: prop },
    1,
    "已看图",
  );
  s.act(p, prop, { type: "accept" }, { role: "coordinator" }, 1, "通过");
  assert.throws(
    () =>
      images.task(
        p,
        { ...sample, name: "脸部", purpose: "面部特写", basisTaskId: prop },
        "wrong",
      ),
    /人物图片/,
  );
  const detail = images.task(
    p,
    { ...args, purpose: "局部特写" },
    "prop-detail",
  );
  assert.ok(detail);
});
function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-images-")),
    db = new Database(root),
    s = new StudioService(db),
    p = s.create("出图测试", "生成叶子", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const run = () => {
    const id = randomUUID();
    db.run(
      "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
      id,
      p,
      process.pid,
      new Date().toISOString(),
    );
    return id;
  };
  return { db, s, p, run };
}
test("automatic basis references preserve explicit image order and document the actual mapping", async (t) => {
  const { db, s, p, run } = fixture(t);
  const requests: any[] = [];
  const images = new ImageService(s, async (request) => {
    requests.push(request);
    return decodeGeneratedImage(png);
  });
  const makeApproved = async (name: string, identity = false) => {
    const spec = imageSchema.parse({
      ...args,
      name,
      category: identity ? "人物" : "道具",
      purpose: identity ? "角色正面图" : "单图",
    });
    const taskId = images.task(p, spec, name);
    const image = await images.generate(
      p,
      taskId,
      { ...spec, revision: 0 },
      { role: "executor", taskId },
      run(),
      name,
    );
    s.act(
      p,
      taskId,
      { type: "review" },
      { role: "reviewer", taskId },
      1,
      "已看图",
    );
    s.act(
      p,
      taskId,
      { type: "accept" },
      { role: "coordinator" },
      1,
      "符合要求",
    );
    return { taskId, fileId: image.fileId };
  };
  const basis = await makeApproved("人物身份", true);
  const pose = await makeApproved("姿态示意");
  for (const [key, explicit, expected] of [
    ["append", [pose.fileId], [pose.fileId, basis.fileId]],
    [
      "dedupe",
      [basis.fileId, pose.fileId, basis.fileId],
      [basis.fileId, pose.fileId],
    ],
  ] as const) {
    const spec = imageSchema.parse({
      ...args,
      name: key,
      category: "人物",
      purpose: "动作参考",
      basisTaskId: basis.taskId,
      referenceFileIds: explicit,
    });
    const taskId = images.task(p, spec, key);
    await images.generate(
      p,
      taskId,
      { ...spec, revision: 0 },
      { role: "executor", taskId },
      run(),
      key,
    );
    const stored = db.one<{ reference_ids: string; prompt: string }>(
      "SELECT reference_ids,prompt FROM image_generations WHERE task_id=?",
      taskId,
    )!;
    assert.deepEqual(JSON.parse(stored.reference_ids), expected);
    const request = requests.at(-1)!;
    assert.equal(request.references.length, 2);
    assert.equal(request.prompt, stored.prompt);
    assert.match(
      request.prompt,
      key === "append"
        ? /图1："姿态示意.png"[\s\S]*图2："人物身份.png"（系统追加的已验收首样基准）/
        : /图1："人物身份.png"[\s\S]*图2："姿态示意.png"/,
    );
  }
});

test("native results accept image bytes and reject links, paths and text", () => {
  assert.equal(decodeGeneratedImage(png).mime, "image/png");
  for (const value of [
    "https://example.com/img.png",
    "C:/secrets/file.png",
    Buffer.from("<svg></svg>").toString("base64"),
    "",
  ])
    assert.throws(() => decodeGeneratedImage(value));
});

test("generation is persisted, idempotent and never usable before final acceptance; replacement keeps history", async (t) => {
  const { db, s, p, run } = fixture(t);
  let calls = 0;
  const images = new ImageService(s, async () => {
    calls++;
    assert.equal(s.project(p).messages.at(-1)?.image?.status, "generating");
    return decodeGeneratedImage(png);
  });
  const taskId = images.task(p, args, "one"),
    actor = { role: "executor" as const, taskId },
    rid = run();
  const result = await images.generate(
    p,
    taskId,
    { ...args, revision: 0 },
    actor,
    rid,
    "call",
  );
  assert.equal(s.project(p).assets.length, 0);
  assert.equal(s.project(p).tasks[taskId].delivery, "draft");
  assert.deepEqual([result.width, result.height], [1, 1]);
  assert.match(s.project(p).tasks[taskId].text, /原文件实际像素：1 × 1/);
  assert.equal(s.outputFiles(p, taskId, result.revision)[0].width, 1);
  assert.equal((await readMaterial(db, p, result.fileId)).kind, "image");
  assert.equal(
    (
      await images.generate(
        p,
        taskId,
        { ...args, revision: 0 },
        actor,
        rid,
        "call",
      )
    ).fileId,
    result.fileId,
  );
  assert.equal(calls, 1);
  s.act(
    p,
    taskId,
    { type: "review" },
    { role: "reviewer", taskId },
    1,
    "已检查图片",
  );
  assert.equal(s.project(p).messages.at(-1)?.image?.delivery, "reviewed");
  assert.equal(s.project(p).assets.length, 0);
  s.act(
    p,
    taskId,
    { type: "return", reason: "需要调整颜色" },
    { role: "coordinator" },
    1,
  );
  const second = await images.generate(
    p,
    taskId,
    { ...args, revision: 1 },
    actor,
    run(),
    "new",
  );
  assert.equal(second.revision, 2);
  assert.equal(s.project(p).tasks[taskId].delivery, "draft");
  assert.deepEqual(
    s.outputFiles(p, taskId, 2).map((f) => f.id),
    [second.fileId],
  );
  assert.deepEqual(
    s.outputFiles(p, taskId, 1).map((f) => f.id),
    [result.fileId],
  );
  assert.equal(
    s.project(p).messages.find((m) => m.image?.file?.id === result.fileId)
      ?.image?.current,
    false,
  );
  s.act(
    p,
    taskId,
    { type: "review" },
    { role: "reviewer", taskId },
    2,
    "符合修改要求",
  );
  s.act(p, taskId, { type: "accept" }, { role: "coordinator" }, 2, "满足需求");
  assert.equal(s.project(p).assets.length, 1);
  await assert.rejects(
    images.generate(p, taskId, { ...args, revision: 2 }, actor, run(), "new"),
    /已验收/,
  );
  const other = images.task(p, { ...args, name: "另一个道具" }, "two");
  await images.generate(
    p,
    other,
    {
      ...args,
      name: "另一个道具",
      revision: 0,
      referenceFileIds: [second.fileId],
    },
    { role: "executor", taskId: other },
    run(),
    "ref",
  );
  s.act(
    p,
    other,
    { type: "review" },
    { role: "reviewer", taskId: other },
    1,
    "独立资产",
  );
  s.act(p, other, { type: "accept" }, { role: "coordinator" }, 1, "符合需求");
  assert.equal(new Set(s.project(p).assets.map((a) => a.id)).size, 2);
  assert.deepEqual(
    s.project(p).assets.find((a) => a.taskId === other)?.sourceIds,
    [s.project(p).assets.find((a) => a.taskId === taskId)!.id],
  );
  const approved = () => s.project(p).assets.find((a) => a.taskId === taskId)!;
  assert.equal(approved().outputRevision, 2);
  assert.deepEqual(
    approved().files?.map((f) => f.id),
    [second.fileId],
  );
  assert.equal(approved().files?.[0].url, `/api/files/${second.fileId}`);
});

test("own rejected historical image can guide a later revision without approval or cross-task reuse", async (t) => {
  const { db, s, p, run } = fixture(t);
  const requests: string[][] = [];
  const images = new ImageService(s, async (request) => {
    requests.push(request.references);
    return decodeGeneratedImage(png);
  });
  const taskId = images.task(p, args, "history"),
    actor = { role: "executor" as const, taskId };
  const first = await images.generate(
    p,
    taskId,
    { ...args, revision: 0 },
    actor,
    run(),
    "v1",
  );
  s.act(
    p,
    taskId,
    { type: "return", reason: "修改颜色" },
    { role: "reviewer", taskId },
    1,
  );
  await images.generate(
    p,
    taskId,
    { ...args, revision: 1 },
    actor,
    run(),
    "v2",
  );
  s.act(
    p,
    taskId,
    { type: "return", reason: "采用v1姿态但修正颜色" },
    { role: "reviewer", taskId },
    2,
  );
  const third = await images.generate(
    p,
    taskId,
    { ...args, revision: 2, referenceFileIds: [first.fileId] },
    actor,
    run(),
    "v3",
  );
  assert.equal(third.revision, 3);
  const original = await readMaterial(db, p, first.fileId);
  assert.deepEqual(requests[2], [original.kind === "image" && original.url]);
  assert.equal(s.outputFiles(p, taskId, 1)[0].id, first.fileId);
  assert.equal(s.project(p).tasks[taskId].delivery, "draft");
  assert.equal(s.project(p).assets.length, 0);
  const other = images.task(p, args, "other-history");
  await assert.rejects(
    images.generate(
      p,
      other,
      { ...args, revision: 0, referenceFileIds: [first.fileId] },
      { role: "executor", taskId: other },
      run(),
      "cross-task",
    ),
    /尚未验收/,
  );
  db.run(
    "INSERT INTO image_trash(file_id,reason,actor,trashed_at) VALUES(?,?,?,?)",
    first.fileId,
    "旧版不再使用",
    "human",
    new Date().toISOString(),
  );
  await assert.rejects(
    images.generate(
      p,
      taskId,
      { ...args, revision: 3, referenceFileIds: [first.fileId] },
      actor,
      run(),
      "trashed-history",
    ),
    /垃圾篓/,
  );
  assert.equal(requests.length, 3);
});

test("failed generation reports failure, blocks same-turn retries and rejects unapproved/cross-project references", async (t) => {
  const { s, p, run } = fixture(t);
  let calls = 0;
  const images = new ImageService(s, async () => {
      calls++;
      throw new Error("额度不足");
    }),
    taskId = images.task(p, args, "one"),
    actor = { role: "executor" as const, taskId },
    rid = run();
  await assert.rejects(
    images.generate(
      p,
      taskId,
      { ...args, revision: 0 },
      { role: "coordinator" },
      rid,
      "bad",
    ),
    /制作节点/,
  );
  await assert.rejects(
    images.generate(p, taskId, { ...args, revision: 0 }, actor, rid, "fail"),
    /额度不足/,
  );
  await assert.rejects(
    images.generate(p, taskId, { ...args, revision: 0 }, actor, rid, "retry"),
    /停止自动重试/,
  );
  assert.equal(calls, 1);
  assert.equal(s.project(p).messages.at(-1)?.image?.status, "failed");
  assert.equal(s.outputFiles(p, taskId, 0).length, 0);
  assert.equal(s.project(p).tasks[taskId].revision, 0);
  const success = new ImageService(s, async () => decodeGeneratedImage(png));
  const image = await success.generate(
    p,
    taskId,
    { ...args, revision: 0 },
    actor,
    run(),
    "success",
  );
  const other = success.task(p, args, "other");
  await assert.rejects(
    success.generate(
      p,
      other,
      { ...args, revision: 0, referenceFileIds: [image.fileId] },
      { role: "executor", taskId: other },
      run(),
      "ref",
    ),
    /尚未验收/,
  );
  const alien = s.create("另一个项目", "", []),
    alienTask = success.task(alien, args, "alien");
  await assert.rejects(
    success.generate(
      alien,
      alienTask,
      { ...args, revision: 0, referenceFileIds: [image.fileId] },
      { role: "executor", taskId: alienTask },
      run(),
      "alien",
    ),
    /不属于当前剧本/,
  );
});

test("task changes during rendering discard files; failed atomic save rolls back nested writes", async (t) => {
  const { db, s, p, run } = fixture(t);
  const images = new ImageService(s, async () => {
    s.act(p, id, { type: "toggle-executor" }, { role: "human" }, 0);
    return decodeGeneratedImage(png);
  });
  const id = images.task(p, args, "one");
  await assert.rejects(
    images.generate(
      p,
      id,
      { ...args, revision: 0 },
      { role: "executor", taskId: id },
      run(),
      "call",
    ),
    /任务已改变/,
  );
  assert.equal(db.one<any>("SELECT count(*) n FROM files")!.n, 0);
  assert.equal(readdirSync(path.join(db.root, "files")).length, 0);
  s.act(p, id, { type: "toggle-executor" }, { role: "human" }, 0);
  db.run(
    "CREATE TRIGGER reject_image_commit BEFORE UPDATE OF status ON image_generations WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'test rollback'); END",
  );
  const success = new ImageService(s, async () => decodeGeneratedImage(png));
  await assert.rejects(
    success.generate(
      p,
      id,
      { ...args, revision: 0 },
      { role: "executor", taskId: id },
      run(),
      "fail",
    ),
    /test rollback/,
  );
  assert.equal(db.one<any>("SELECT count(*) n FROM files")!.n, 0);
  assert.equal(s.project(p).tasks[id].revision, 0);
  assert.equal(readdirSync(path.join(db.root, "files")).length, 0);
});

test("chat generation routes through production and independent review; both reviewers must see real images", async (t) => {
  const { db, s, p } = fixture(t);
  let sequence = 0,
    rendered = 0,
    id = "",
    fileId = "",
    reviewed = false;
  const connect = () => {
    let threadId = "",
      role = "";
    const c: AiConnection = {
      notices: new Set(),
      onRequest: async () => ({}),
      initialize: async () => {},
      close: () => {},
      request: async (method, params: RpcData = {}) => {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ isDefault: true, model: "test" }] };
        if (method === "mcpServerStatus/list") return { data: [] };
        if (method === "thread/start" || method === "thread/resume") {
          threadId = String(params.threadId ?? `images-${++sequence}`);
          role = String(params.baseInstructions).includes("# 独立审核 AI")
            ? "reviewer"
            : String(params.baseInstructions).includes("# 资产制作 AI")
              ? "executor"
              : "coordinator";
          return { thread: { id: threadId } };
        }
        if (method === "turn/start") {
          const call = (tool: string, arguments_: unknown) =>
            c.onRequest("item/tool/call", {
              threadId,
              tool,
              callId: randomUUID(),
              arguments: arguments_,
            }) as Promise<any>;
          if (role === "executor") {
            id = Object.keys(s.project(p).tasks).find((k) =>
              k.startsWith("chat-image-"),
            )!;
            assert.equal(
              (
                await call("generate_image", {
                  ...args,
                  taskId: id,
                  revision: 0,
                })
              ).success,
              true,
            );
            fileId = s.outputFiles(p, id, 1)[0].id;
          } else if (role === "reviewer") {
            assert.equal(s.project(p).tasks[id].delivery, "draft");
            assert.equal(
              (
                await call("act", {
                  taskId: id,
                  revision: 1,
                  action: { type: "review" },
                  reason: "只读提示词",
                })
              ).success,
              false,
            );
            assert.equal(
              (await call("read_material", { fileId })).success,
              true,
            );
            assert.equal(
              (
                await call("act", {
                  taskId: id,
                  revision: 1,
                  action: { type: "review" },
                  reason: "图片与目标一致",
                })
              ).success,
              true,
            );
            reviewed = true;
          } else {
            assert.equal((await call("generate_image", args)).success, true);
            assert.ok(reviewed);
            assert.equal(s.project(p).assets.length, 0);
            assert.equal(
              (
                await call("act", {
                  taskId: id,
                  revision: 1,
                  action: { type: "accept" },
                  reason: "未看图",
                })
              ).success,
              false,
            );
            await call("read_material", { fileId });
            assert.equal(
              (
                await call("act", {
                  taskId: id,
                  revision: 1,
                  action: { type: "accept" },
                  reason: "已核对实际图片，满足用户目标",
                })
              ).success,
              true,
            );
          }
          for (const notice of c.notices)
            notice("turn/completed", {
              threadId,
              turn: { status: "completed" },
            });
          return { turn: { id: `turn-${sequence}` } };
        }
        return {};
      },
    };
    return c;
  };
  const runtime = new AiRuntime(s, connect, async () => {
    rendered++;
    return decodeGeneratedImage(png);
  });
  const run = runtime.queue(p, "生成一张绿色叶子图片", randomUUID());
  await runtime.start(run.id);
  assert.equal(s.project(p).run?.status, "completed");
  assert.equal(rendered, 1);
  assert.equal(s.project(p).tasks[id].delivery, "approved");
  assert.equal(s.project(p).assets.length, 1);
  assert.equal(
    s.project(p).messages.find((m) => m.image)?.image?.delivery,
    "approved",
  );
  assert.equal(
    db.one<any>("SELECT count(*) n FROM reviews WHERE task_id=?", id)!.n,
    2,
  );
  assert.ok(
    s
      .project(p)
      .messages.every(
        (m) =>
          !m.text.includes("本次图片要求：") &&
          !m.text.includes("generate_image"),
      ),
  );
});

test("explicit generation replaces an existing text draft even after a batch checkpoint", async (t) => {
  const { db, s, p, run } = fixture(t),
    images = new ImageService(s, async () => decodeGeneratedImage(png));
  const id = images.task(p, args, "existing"),
    actor = { role: "executor" as const, taskId: id };
  s.act(
    p,
    id,
    { type: "save", text: "此前只有制作说明", reuseReason: "需新建" },
    actor,
    0,
  );
  const pipeline = new NodePipeline(s),
    job = pipeline.start(p, id, "生成实际图片", run());
  const paused = await pipeline.drive(
    p,
    job,
    "生成实际图片",
    async () => {
      throw new NodeBatchYield("executor");
    },
    true,
  );
  assert.equal(paused.status, "continuing");
  const turns: string[] = [];
  const result = await pipeline.drive(p, job, "恢复", async (who) => {
    turns.push(who.role);
    if (who.role === "executor")
      await images.generate(
        p,
        id,
        { ...args, revision: 1 },
        who,
        run(),
        "render",
      );
    else s.act(p, id, { type: "review" }, who, 2, "实际图片已查验");
    return "完成";
  });
  assert.equal(result.status, "submitted");
  assert.deepEqual(turns, ["executor", "reviewer"]);
  assert.equal(s.outputFiles(p, id, 2).length, 1);
  assert.equal(
    db.one<any>("SELECT status FROM node_checkpoints WHERE job_id=?", job)
      ?.status,
    "resumed",
  );
});

test("derivative images finish under their reviewer; samples, disabled review, stale versions and questions cannot bypass coordinator", async (t) => {
  const { db, s, p, run } = fixture(t);
  const images = new ImageService(s, async () => decodeGeneratedImage(png));
  const pipeline = new NodePipeline(s);
  const sample = {
    ...args,
    name: "角色首样",
    category: "人物" as const,
    purpose: "穿衣首样" as const,
  };
  const basis = images.task(p, sample, "delegation-basis");
  await images.generate(
    p,
    basis,
    { ...sample, revision: 0 },
    { role: "executor", taskId: basis },
    run(),
    "basis",
  );
  s.act(
    p,
    basis,
    { type: "review" },
    { role: "reviewer", taskId: basis },
    1,
    "已看首样",
  );
  assert.equal(s.acceptReviewedImage(p, basis, 1), false);
  assert.throws(() =>
    s.act(
      p,
      basis,
      { type: "accept" },
      { role: "reviewer", taskId: basis },
      1,
      "越权",
    ),
  );
  s.act(p, basis, { type: "accept" }, { role: "coordinator" }, 1, "基准通过");
  const spec = {
    ...sample,
    name: "角色三视图",
    purpose: "角色三视图" as const,
    basisTaskId: basis,
  };
  const id = images.task(p, spec, "delegation-child");
  const job = pipeline.start(p, id, "补充三视图", run());
  let reviewed = false;
  const result = await pipeline.drive(p, job, "补充三视图", async (actor) => {
    if (actor.role === "executor") {
      await images.generate(
        p,
        id,
        { ...spec, revision: 0 },
        actor,
        run(),
        "child",
      );
      assert.equal(s.acceptReviewedImage(p, id, 1), false);
    } else {
      s.act(p, id, { type: "review" }, actor, 1, "已看本版图片，与首样一致");
      reviewed = true;
      assert.throws(() => s.acceptReviewedImage(p, id, 0), /版本已变化/);
      assert.throws(() =>
        s.act(
          p,
          id,
          { type: "accept" },
          { role: "reviewer", taskId: basis },
          1,
          "跨节点越权",
        ),
      );
    }
    return "";
  });
  assert.ok(reviewed);
  assert.equal(result.status, "completed");
  assert.equal(s.project(p).tasks[id].delivery, "approved");
  assert.ok(s.project(p).assets.some((asset) => asset.taskId === id));
  assert.equal(
    db.one<{ actor: string }>(
      "SELECT actor FROM reviews WHERE task_id=? AND stage='acceptance'",
      id,
    )?.actor,
    "reviewer",
  );
  assert.ok(
    s
      .project(p)
      .events.filter((e) => e.taskId === id && e.action === "accept")
      .every((e) => !e.text.includes("总控验收通过")),
  );

  const blocked = images.task(
    p,
    { ...spec, name: "待澄清三视图" },
    "delegation-blocked",
  );
  const blockedJob = pipeline.start(p, blocked, "制作", run());
  await images.generate(
    p,
    blocked,
    { ...spec, name: "待澄清三视图", revision: 0 },
    { role: "executor", taskId: blocked },
    run(),
    "blocked",
  );
  const question = pipeline.question(
    p,
    blockedJob,
    { role: "executor", taskId: blocked },
    "是否改变人物年龄？",
  );
  pipeline.decide(
    p,
    blockedJob,
    { role: "reviewer", taskId: blocked },
    question.questionId,
    true,
    "改变首样方向",
  );
  s.act(
    p,
    blocked,
    { type: "review" },
    { role: "reviewer", taskId: blocked },
    1,
    "审核记录",
  );
  assert.equal(s.acceptReviewedImage(p, blocked, 1), false);

  const disabled = images.task(
    p,
    { ...spec, name: "关闭审核" },
    "delegation-disabled",
  );
  s.act(p, disabled, { type: "toggle-review" }, { role: "human" }, 0);
  const disabledJob = pipeline.start(p, disabled, "补图", run());
  const waiting = await pipeline.drive(
    p,
    disabledJob,
    "补图",
    async (actor) => {
      assert.equal(actor.role, "executor");
      await images.generate(
        p,
        disabled,
        { ...spec, name: "关闭审核", revision: 0 },
        actor,
        run(),
        "disabled",
      );
      return "";
    },
  );
  assert.equal(waiting.status, "submitted");
  assert.equal(s.project(p).tasks[disabled].delivery, "draft");
  assert.equal(s.acceptReviewedImage(p, disabled, 1), false);
});
