import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { ImageService, imageSchema } from "../src/server/ai/images";
import { decodeGeneratedImage } from "../src/server/ai/image-provider";
import {
  createResourcePackage,
  safePackageName,
} from "../src/server/resource-package";
import { resourceShots } from "../src/domain/resource-package";
import { filePath } from "../src/server/files";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
async function fixture(t: any) {
  const root = mkdtempSync(path.join(tmpdir(), "drama-export-"));
  const db = new Database(root),
    service = new StudioService(db),
    p = service.create("测试/资源包", "私有聊天不应导出", []);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const human = { role: "human" } as const;
  const accept = (id: string) => {
    const revision = service.project(p).tasks[id].revision;
    if (service.project(p).tasks[id].reviewEnabled)
      service.act(p, id, { type: "review" }, human, revision, "已核对");
    service.act(
      p,
      id,
      { type: "accept" },
      human,
      revision,
      "本版通过，1×1 为测试规格，不适用于其他镜头",
    );
  };
  for (const id of ["source", "brief"]) {
    service.act(
      p,
      id,
      {
        type: "save",
        text: id === "source" ? "原文内容不应导出" : "电影级写实，横屏",
      },
      human,
      0,
    );
    accept(id);
  }
  const images = new ImageService(service, async () =>
    decodeGeneratedImage(png),
  );
  const args = imageSchema.parse({
    name: "同名角色",
    purpose: "穿衣首样",
    prompt: "干净背景的角色",
    reuseReason: "测试创建",
  });
  const imageTask = images.task(p, args, "shared-image"),
    run = randomUUID();
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
    run,
    p,
    process.pid,
    new Date().toISOString(),
  );
  const generated = await images.generate(
    p,
    imageTask,
    { ...args, revision: 0 },
    { role: "executor", taskId: imageTask },
    run,
    "sample",
  );
  accept(imageTask);
  const assetId = service.project(p).assets[0].id;
  const kitFiles: string[] = [];
  for (const purpose of [
    "角色三视图",
    "面部特写",
    "服装图",
    "穿衣组合",
  ] as const) {
    const spec = imageSchema.parse({
      ...args,
      name: purpose,
      purpose,
      basisTaskId: imageTask,
      referenceFileIds:
        purpose === "穿衣组合" ? [kitFiles[0], kitFiles[2]] : [],
    });
    const id = images.task(p, spec, purpose);
    const out = await images.generate(
      p,
      id,
      { ...spec, revision: 0 },
      { role: "executor", taskId: id },
      run,
      purpose,
    );
    accept(id);
    kitFiles.push(out.fileId!);
  }
  const ids = ["episode-1-shot-1-board", "episode-1-shot-2-board"];
  for (let i = 1; i <= 2; i++) {
    const board = ids[i - 1],
      assets = `episode-1-shot-${i}-assets`;
    db.run(
      "INSERT INTO tasks VALUES(?,?,'board',?,'分镜',1,?,1,1)",
      p,
      board,
      `镜头${i}`,
      i,
    );
    db.run(
      "INSERT INTO tasks VALUES(?,?,'assets','基础资产','资产',1,?,1,1)",
      p,
      assets,
      i,
    );
    db.run("INSERT INTO dependencies VALUES(?,?,?)", p, assets, board);
    service.act(
      p,
      board,
      { type: "save", text: `## 镜头${i}\n保持身份一致。` },
      human,
      0,
    );
    accept(board);
    service.act(
      p,
      assets,
      {
        type: "save",
        text: "正式修订：单人、无簪，不添加早期提到的差役。",
        assetIds: [assetId],
        reuseReason: "复用通过的人物",
      },
      human,
      0,
    );
    accept(assets);
  }
  return { db, service, p, ids, imageTask, fileId: generated.fileId!, assetId };
}

test("offline ZIP contains actual approved bytes, scoped shot documents, revisions and deduplicated shared images without requiring video or frames", async (t) => {
  const { service, p, ids, fileId } = await fixture(t);
  const version = service.project(p).version!;
  const { buffer, manifest } = await createResourcePackage(
    service,
    p,
    ids,
    version,
  );
  const zip = await JSZip.loadAsync(buffer);
  assert.equal(manifest.shots.length, 2);
  assert.equal(manifest.files.length, 5);
  assert.equal(manifest.files[0].id, fileId);
  assert.equal(manifest.files[0].width, 1);
  assert.deepEqual(
    await zip.file(manifest.files[0].path!)!.async("nodebuffer"),
    Buffer.from(png, "base64"),
  );
  assert.match(
    await zip.file("镜头/E01-S01/资产与修订.md")!.async("text"),
    /单人、无簪/,
  );
  const note = await zip.file("镜头/E01-S01/制作说明.md")!.async("text");
  assert.match(note, /未含已验收镜头画面/);
  assert.match(note, /\.\.\/\.\.\/.*\.png/);
  assert.doesNotMatch(note, /\/api\/files/);
  assert.match(await zip.file("开始制作.md")!.async("text"), /2 \/ 2/);
  const text = (
    await Promise.all(
      Object.values(zip.files)
        .filter((file) => file.name.endsWith(".md"))
        .map((file) => file.async("text")),
    )
  ).join();
  assert.doesNotMatch(text, /私有聊天不应导出|原文内容不应导出/);
  assert.equal(service.project(p).version, version); // Export never advances/accepts tasks.
  for (const name of Object.keys(zip.files))
    assert.ok(!name.startsWith("/") && !name.split("/").includes(".."));
});

test("approved frame prompt is exported verbatim separately from image and management instructions", async (t) => {
  const { db, service, p, ids } = await fixture(t);
  const taskId = "episode-1-shot-1-frames",
    run = randomUUID();
  db.run(
    "INSERT INTO tasks VALUES(?,?,'frames','镜头画面','起幅',1,1,1,1)",
    p,
    taskId,
  );
  db.run(
    "INSERT INTO dependencies VALUES(?,?,?)",
    p,
    taskId,
    "episode-1-shot-1-assets",
  );
  db.run(
    "INSERT INTO runs(id,project_id,status,process_id,started_at) VALUES(?,?,'completed',?,?)",
    run,
    p,
    process.pid,
    new Date().toISOString(),
  );
  const images = new ImageService(service, async () =>
    decodeGeneratedImage(png),
  );
  const args = imageSchema.parse({
    name: "镜头起幅",
    prompt: "静态画面",
    purpose: "单图",
    category: "人物",
    reuseReason: "本镜头使用",
  });
  await images.generate(
    p,
    taskId,
    { ...args, revision: 0 },
    { role: "executor", taskId },
    run,
    "frame",
  );
  const prompt = "相机缓缓后退，人物朝右前方飞行。\n黑发向左后方扬起。";
  service.act(
    p,
    taskId,
    {
      type: "save",
      text: `## 上传说明\n将原图作为首帧。\n## 干净图生视频提示词（独立输入）\n${prompt}\n## 后期\n裁切到3秒。`,
    },
    { role: "executor", taskId },
    1,
  );
  service.act(
    p,
    taskId,
    { type: "review" },
    { role: "reviewer", taskId },
    2,
    "已看实际图及完整交接",
  );
  service.act(
    p,
    taskId,
    { type: "accept" },
    { role: "coordinator" },
    2,
    "符合本镜要求",
  );
  const result = await createResourcePackage(
    service,
    p,
    [ids[0]],
    service.project(p).version!,
  );
  const zip = await JSZip.loadAsync(result.buffer);
  const promptPath = result.manifest.shots[0].videoPromptPath!;
  assert.equal(await zip.file(promptPath)!.async("text"), prompt);
  assert.match(
    await zip.file("镜头/E01-S01/制作说明.md")!.async("text"),
    /视频提示词\.txt/,
  );
  assert.match(
    await zip.file("镜头/E01-S01/镜头画面说明.md")!.async("text"),
    /上传说明[\s\S]*裁切到3秒/,
  );
});

test("unfinished, missing, trashed and stale resources cannot be exported as a complete package", async (t) => {
  const { db, service, p, ids, fileId } = await fixture(t);
  const version = service.project(p).version!;
  await assert.rejects(
    createResourcePackage(service, p, ids, version - 1),
    /已更新/,
  );
  await assert.rejects(
    createResourcePackage(service, p, [ids[0], ids[0]], version),
    /不同镜头/,
  );
  await assert.rejects(
    createResourcePackage(service, p, ["other-project-shot"], version),
    /不属于/,
  );
  db.run(
    "DELETE FROM reviews WHERE project_id=? AND task_id='episode-1-shot-1-assets'",
    p,
  );
  await assert.rejects(
    createResourcePackage(service, p, [ids[0]], version),
    /尚未验收/,
  );
  // Still permit exporting the independently ready second shot.
  assert.equal(
    (await createResourcePackage(service, p, [ids[1]], version)).manifest
      .selectedShots,
    1,
  );
  db.run(
    "INSERT INTO image_trash VALUES(?,?,'human',NULL,?)",
    fileId,
    "已淘汰",
    new Date().toISOString(),
  );
  await assert.rejects(
    createResourcePackage(service, p, [ids[1]], version),
    /关联资产缺少/,
  );
});

test("original-file corruption is detected instead of silently producing an incomplete or modified ZIP", async (t) => {
  const { db, service, p, ids, fileId } = await fixture(t);
  writeFileSync(
    filePath(db, fileId),
    Buffer.alloc(Buffer.from(png, "base64").length),
  );
  await assert.rejects(
    createResourcePackage(service, p, ids, service.project(p).version!),
    /校验失败/,
  );
});

test("candidate selection excludes unapproved frames but includes approved files and rejects text-only asset claims", async (t) => {
  const { service, p, ids, fileId } = await fixture(t);
  const snapshot = service.snapshot(),
    project = snapshot.state.projects.find((item) => item.id === p)!;
  const board = project.tasks[ids[0]],
    frameId = "episode-1-shot-1-frames";
  project.tasks[frameId] = {
    ...board,
    id: frameId,
    kind: "frames",
    delivery: "draft",
    dependencies: ["episode-1-shot-1-assets"],
  };
  snapshot.files[`${p}/${frameId}`] = [
    {
      id: "unapproved",
      name: "未审核.png",
      type: "image/png",
      url: "/private",
      size: 1,
    },
  ];
  const first = resourceShots(project, snapshot.files)[0];
  assert.equal(first.issues.length, 0);
  assert.equal(first.files.length, 5);
  assert.ok(first.files.some((file) => file.id === fileId));
  project.tasks[frameId].delivery = "approved";
  assert.equal(resourceShots(project, snapshot.files)[0].files.length, 6);
  project.tasks["episode-1-shot-1-assets"].assetIds = [];
  project.tasks[frameId].delivery = "draft";
  assert.match(
    resourceShots(project, snapshot.files)[0].issues.join(),
    /文字设定不能代替图片/,
  );
  assert.ok(!safePackageName("../../CON<>:人物").includes("/"));
  assert.match(safePackageName("CON"), /^资源_/);
});
