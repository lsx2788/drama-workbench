import JSZip from "jszip";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resourceShots } from "../domain/resource-package";
import { videoPrompt } from "../domain/video-prompt";
import type { MediaFile, Task } from "../domain/types";
import { filePath } from "./files";
import { ensure } from "./errors";
import type { StudioService } from "./studio-service";

export function safePackageName(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f\[\]()#%]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 65);
  return !cleaned ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
    ? `资源_${cleaned || "未命名"}`
    : cleaned;
}

export async function createResourcePackage(
  service: StudioService,
  projectId: string,
  shotIds: string[],
  expectedVersion: number,
) {
  // Freeze the export plan in one consistent database snapshot, then perform file I/O outside the transaction.
  const snapshot = service.db.transaction(() => {
    const project = service.project(projectId);
    ensure(
      project.version === expectedVersion,
      "资源已更新，请刷新导出窗口后重试",
      "CONFLICT",
      409,
    );
    ensure(
      shotIds.length > 0 &&
        shotIds.length <= 200 &&
        new Set(shotIds).size === shotIds.length,
      "请选择 1～200 个不同镜头",
    );
    const files: Record<string, MediaFile[]> = {};
    for (const task of Object.values(project.tasks).filter(
      (task) =>
        ["assets", "frames"].includes(task.kind) &&
        task.delivery === "approved",
    )) {
      files[`${projectId}/${task.id}`] = service
        .outputFiles(projectId, task.id, task.revision)
        .map((file) => ({
          id: file.id,
          name: file.name,
          type: file.mime,
          size: file.size,
          url: `/api/files/${file.id}`,
          width: file.width,
          height: file.height,
        }));
    }
    const candidates = resourceShots(project, files);
    const selected = shotIds
      .map((id) => {
        const shot = candidates.find((candidate) => candidate.board.id === id);
        ensure(shot, "所选镜头不存在或不属于当前剧本", "NOT_FOUND", 404);
        ensure(
          !shot.issues.length,
          `第 ${shot.board.episode} 集镜头 ${shot.board.shot} 尚不能导出：${shot.issues.join("；")}`,
          "CONFLICT",
          409,
        );
        return shot;
      })
      .sort(
        (a, b) =>
          a.board.episode! - b.board.episode! || a.board.shot! - b.board.shot!,
      );
    const uniqueFiles = [
      ...new Map(
        selected.flatMap((shot) => shot.files).map((file) => [file.id!, file]),
      ).values(),
    ];
    const media = uniqueFiles.map((file) => {
      const stored = service.db.one<{ id: string; hash: string; size: number }>(
        "SELECT id,hash,size FROM files WHERE id=? AND project_id=? AND scope='output' AND mime LIKE 'image/%' AND NOT EXISTS(SELECT 1 FROM image_trash b WHERE b.file_id=files.id)",
        file.id!,
        projectId,
      );
      ensure(stored, `图片不可用：${file.name}`, "CONFLICT", 409);
      return { ...file, id: stored.id, hash: stored.hash, size: stored.size };
    });
    ensure(
      media.reduce((sum, file) => sum + file.size, 0) <= 250 * 1024 * 1024,
      "本次资源超过 250 MB，请分批选择镜头导出",
    );
    return { project, candidates, selected, media };
  });
  const { project, selected, media } = snapshot;
  const zip = new JSZip(),
    paths = new Map<string, string>();
  for (const file of media) {
    const owner = selected
      .flatMap((shot) => shot.assets)
      .find((asset) => asset.files?.some((image) => image.id === file.id));
    const folder = owner
      ? `资源/${safePackageName(owner.category)}/${safePackageName(owner.name)}`
      : "资源/镜头画面与附件";
    const extension = (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
      } as Record<string, string>
    )[file.type];
    ensure(extension, `不支持打包的图片类型：${file.type}`);
    const fileName = `${file.id}-${safePackageName(file.name.replace(/\.[^.]+$/, ""))}.${extension}`;
    const relative = `${folder}/${fileName}`;
    const local = filePath(service.db, file.id);
    const metadata = await stat(local).catch(() => undefined);
    ensure(
      metadata?.isFile() && metadata.size === file.size,
      `图片原件缺失或大小异常：${file.name}，请先修复资源`,
      "CONFLICT",
      409,
    );
    const bytes = await readFile(local);
    ensure(
      createHash("sha256").update(bytes).digest("hex") === file.hash,
      `图片原件校验失败：${file.name}`,
      "CONFLICT",
      409,
    );
    zip.file(relative, bytes, { compression: "STORE" });
    paths.set(file.id, relative);
  }
  const link = (file: MediaFile, prefix = "") =>
    `[${file.name.replace(/[\[\]]/g, "_")}](${encodeURI(prefix + paths.get(file.id!)!)})`;
  const remarks = (task: Task) =>
    project.events
      .filter(
        (event) =>
          event.taskId === task.id &&
          event.revision === task.revision &&
          ["accept", "materialized"].includes(event.action),
      )
      .map((event) => `- ${event.text}`)
      .join("\n");
  const localText = (text: string, prefix: string) =>
    text.replace(
      /(?:https?:\/\/[^\s)]+)?\/api\/files\/([a-f\d-]{36})/gi,
      (original, id) =>
        paths.has(id) ? encodeURI(prefix + paths.get(id)!) : original,
    );
  const taskText = (task: Task, prefix: string) =>
    `# ${task.title}\n\n版本：v${task.revision} · 已验收\n\n## 本版验收依据\n${remarks(task) || "以已保存的验收状态为准。"}\n\n## 已保存原文\n\n${localText(task.text, prefix)}`;
  zip.file("制作需求.md", taskText(project.tasks.brief, ""));
  const assetRecords = [
    ...new Map(
      selected.flatMap((shot) => shot.assets).map((asset) => [asset.id, asset]),
    ).values(),
  ];
  zip.file(
    "资产说明.md",
    [
      "# 本次关联的已验收资产",
      ...assetRecords.map(
        (asset) =>
          `## ${asset.name} · v${asset.version}\n\n${(asset.files ?? [])
            .filter((file) => paths.has(file.id!))
            .map((file) => `- ${link(file)}`)
            .join("\n")}\n\n${localText(asset.description, "")}`,
      ),
    ].join("\n\n"),
  );
  const shotRecords = selected.map((shot) => {
    const label = `E${String(shot.board.episode).padStart(2, "0")}-S${String(shot.board.shot).padStart(2, "0")}`;
    const folder = `镜头/${label}`;
    const prompt = shot.frames ? videoPrompt(shot.frames.text) : undefined;
    if (prompt) zip.file(`${folder}/视频提示词.txt`, prompt);
    zip.file(`${folder}/分镜词.md`, taskText(shot.board, "../../"));
    zip.file(`${folder}/资产与修订.md`, taskText(shot.assetTask!, "../../"));
    if (shot.frames)
      zip.file(`${folder}/镜头画面说明.md`, taskText(shot.frames, "../../"));
    zip.file(
      `${folder}/制作说明.md`,
      [
        `# ${label} · ${shot.board.title}`,
        ...(prompt
          ? [
              "[直接复制视频提示词](视频提示词.txt)：本文件逐字摘自本镜已验收画面交接中的独立生成正文，未改写。对应上传图片、时长与剪辑方式请看下方说明。",
            ]
          : []),
        shot.frames
          ? "## 复制提示词与选图\n先打开[镜头画面说明](镜头画面说明.md)，按其中已验收的外部生成交付说明，复制视频提示词文本块，并选用明确标注的首帧、尾帧或参考图片。管理说明、文件编号和剪辑备注不用粘进视频提示词；角色规范图也不应全部当成首帧上传。\n\n[分镜词](分镜词.md)保留镜头设计，[资产与修订](资产与修订.md)保留资产约束。画面制作时已明确修订的细节按相应验收说明执行；若仍有未解决冲突，先核对后再生成。"
          : "## 复制提示词与选图\n从[分镜词](分镜词.md)读取本镜头提示词，结合[资产与修订](资产与修订.md)选用参考图片。本镜头尚无已验收画面，需按外部平台支持的参考图或画面制作方式使用基础资产，不能把角色规范图直接当成已完成的镜头首帧。",
        "本包保留已验收原文与验收依据，不自动重写视频提示词。请核对正式修订，不直接照抄已被替代的旧描述。",
        ...shot.warnings.map((warning) => `提示：${warning}`),
        "## 对应图片",
        ...shot.files.map(
          (file) =>
            `- ${link(file, "../../")}${file.width && file.height ? ` · 实际 ${file.width}×${file.height}` : ""}`,
        ),
        "图片尺寸是原文件尺寸。单镜头获准的规格例外不自动适用于其他镜头。可在外部工具制作视频，无需回到本工作流才能使用资源。",
      ].join("\n\n"),
    );
    return {
      id: shot.board.id,
      episode: shot.board.episode,
      shot: shot.board.shot,
      title: shot.board.title,
      directory: folder,
      boardRevision: shot.board.revision,
      assetRevision: shot.assetTask!.revision,
      frameRevision: shot.frames?.revision,
      ...(prompt ? { videoPromptPath: `${folder}/视频提示词.txt` } : {}),
      assetIds: shot.assets.map((asset) => asset.id),
      fileIds: shot.files.map((file) => file.id),
      warnings: shot.warnings,
    };
  });
  const exportedAt = new Date().toISOString();
  const manifest = {
    format: 1,
    project: { id: project.id, name: project.name, version: project.version },
    exportedAt,
    scope: "selected-shots",
    selectedShots: selected.length,
    knownShots: snapshot.candidates.length,
    shots: shotRecords,
    assets: assetRecords.map((asset) => ({
      id: asset.id,
      name: asset.name,
      version: asset.version,
      taskId: asset.taskId,
      outputRevision: asset.outputRevision,
    })),
    files: media.map((file) => ({
      id: file.id,
      name: file.name,
      path: paths.get(file.id),
      type: file.type,
      size: file.size,
      width: file.width,
      height: file.height,
      sha256: file.hash,
    })),
  };
  zip.file("资源清单.json", JSON.stringify(manifest, null, 2));
  zip.file(
    "开始制作.md",
    [
      `# ${project.name} · 视频制作资源包`,
      `导出时间：${exportedAt}\n\n本包为选定镜头：${selected.length} / ${snapshot.candidates.length} 个已有镜头，不代表全剧资源齐备。`,
      "## 使用顺序\n1. 阅读《制作需求.md》，确认风格、画幅和交付范围。\n2. 打开对应镜头的《制作说明.md》。已有验收画面时，优先查看《镜头画面说明.md》中的视频提示词、输入图片用途和剪辑时长，再结合《资产与修订.md》与《分镜词.md》。\n3. 只复制生成用的提示词，按说明上传对应首帧、尾帧或参考图片；不要把全部基础资产都作为首帧。未含画面的镜头需在外部完成画面制作。\n4. 按平台实际支持的时长生成，再依据镜头说明剪辑；设计时长不代表平台必然支持该秒数。\n5. 需要核对版本时查看《资源清单.json》。不要求在本站生成或回填视频。",
      "## 镜头目录",
      ...shotRecords.map(
        (shot) =>
          `- [第 ${shot.episode} 集 · 镜头 ${shot.shot} · ${shot.title}](${encodeURI(shot.directory + "/制作说明.md")})`,
      ),
      "## 说明\n实际图片文件存放在资源目录，共享图片只保存一份。原始小说、聊天记录、未验收版本、暂停废稿及垃圾篓图片不随包导出。提示词来自已验收原文，不自动改写；请结合后续正式修订与本版验收例外使用。",
    ].join("\n\n"),
  );
  // Abort if a concurrent edit/trash operation changed the checked snapshot while packaging.
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  ensure(
    service.project(projectId).version === expectedVersion,
    "打包期间资源已更新，请重新导出",
    "CONFLICT",
    409,
  );
  return {
    buffer,
    manifest,
    filename: `${safePackageName(project.name)}-视频制作资源-${selected.length}镜头.zip`,
  };
}
