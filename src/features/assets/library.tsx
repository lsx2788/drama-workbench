"use client";
import { RawConversations } from "./raw-conversations";
import { groupBasisAssets } from "./basis-groups";
import { ImageArchive } from "./image-archive";
import type { MediaFile } from "@/domain";

import { useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Folder,
  ImageIcon,
  Search,
  Video,
  Trash2,
  Download,
} from "lucide-react";
import { StudioDialog } from "@/shared/ui/dialog";
import { FilePreview } from "@/shared/ui/file-preview";
import { ExportFiles } from "@/shared/ui/export-files";
import { ChatMarkdown } from "@/shared/ui/chat-markdown";
import type { Asset, StudioProject } from "@/domain";
import {
  assetOutputState,
  taskOutputState,
  outputStateLabels,
  outputStateTones,
  approvedBasisAssets,
} from "@/domain/output-status";

const categories = [
  {
    id: "images",
    title: "图片记录",
    note: "查看各版本图片，整理不再需要的旧图",
    icon: ImageIcon,
  },
  {
    id: "trash",
    title: "垃圾篓",
    note: "查看移入原因，可恢复图片",
    icon: Trash2,
  },
  {
    id: "raw",
    title: "原始会话",
    note: "各节点实际沟通与审核记录",
    icon: FileText,
  },
  {
    id: "source",
    title: "原始资料",
    note: "上传的原文与参考文件",
    icon: FileText,
  },
  {
    id: "documents",
    title: "制作文稿",
    note: "理解报告、需求、剧本与分镜",
    icon: FileText,
  },
  {
    id: "basis",
    title: "基础资产",
    note: "人物、场景、道具与服装",
    icon: Folder,
  },
  {
    id: "frames",
    title: "镜头画面",
    note: "首帧、关键动作图与尾帧",
    icon: ImageIcon,
  },
  {
    id: "videos",
    title: "视频与导出",
    note: "视频预览、镜头成果与导出材料包",
    icon: Video,
  },
] as const;
const librarySections = [
  {
    id: "assets",
    title: "制作成果",
    categories: categories.filter((item) =>
      ["documents", "basis", "frames", "videos"].includes(item.id),
    ),
  },
  {
    id: "sources-and-records",
    title: "原始资料与沟通",
    categories: categories.filter((item) =>
      ["source", "raw"].includes(item.id),
    ),
  },
  {
    id: "image-management",
    title: "图片管理",
    categories: categories.filter(
      (item) => item.id === "images" || item.id === "trash",
    ),
  },
];
export function AssetLibrary({
  project,
  files,
  onTask,
  onRecycle,
  onOrganize,
  onExport,
}: {
  project: StudioProject;
  files: Record<string, MediaFile[]>;
  onTask: (id: string) => void;
  onRecycle: (
    fileId: string,
    action: "trash" | "restore",
    reason: string,
  ) => Promise<boolean>;
  onOrganize: () => Promise<boolean>;
  onExport: () => void;
}) {
  const [category, setCategory] = useState(""),
    [query, setQuery] = useState(""),
    [subtype, setSubtype] = useState("全部");
  const [asset, setAsset] = useState<Asset | null>(null),
    [file, setFile] = useState<MediaFile | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const tasks = Object.values(project.tasks);
  const exports = files[`${project.id}/exports`] ?? [];
  const assetState = (asset: Asset) => assetOutputState(asset, project.tasks);
  const basisAssets = approvedBasisAssets(project.assets);
  const counts: Record<string, number> = {
    images: project.imageLibrary?.filter((image) => !image.trash).length ?? 0,
    trash: project.imageLibrary?.filter((image) => !!image.trash).length ?? 0,
    raw: project.sessions?.length ?? 0,
    source: project.sources.length,
    documents: tasks.filter(
      (t) =>
        t.text && !["assets", "frames", "video", "assembly"].includes(t.kind),
    ).length,
    basis: basisAssets.length,
    frames: tasks.filter(
      (t) =>
        t.kind === "frames" &&
        (files[`${project.id}/${t.id}`]?.length ?? 0) > 0,
    ).length,
    videos:
      exports.length +
      tasks.filter(
        (t) =>
          ["video", "assembly"].includes(t.kind) &&
          (files[`${project.id}/${t.id}`]?.length ?? 0) > 0,
      ).length,
  };
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const assetRows = basisAssets.filter(
    (a) =>
      a.category !== "镜头画面" &&
      matches(a.name + a.description) &&
      (subtype === "全部" || a.category === subtype),
  );
  const assetFiles = (a: Asset) =>
    a.files ?? (a.taskId ? (files[`${project.id}/${a.taskId}`] ?? []) : []);
  const imagesOf = (a: Asset) =>
    assetFiles(a).filter((f) => f.type.startsWith("image/"));
  const groups = groupBasisAssets(assetRows, project.tasks);
  const selectedGroup = subject
    ? groupBasisAssets(basisAssets, project.tasks).find(
        (group) => group.id === subject,
      )
    : undefined;
  const visibleAssets = subject
    ? (groups.find((group) => group.id === subject)?.assets ?? [])
    : [];
  return (
    <div className="studio-library">
      <div className="studio-library-export">
        <button onClick={onExport}>
          <Download size={15} />
          资源导出
        </button>
      </div>
      {category ? (
        <div className="studio-library-toolbar">
          <button
            onClick={() => {
              if (subject) setSubject(null);
              else setCategory("");
              setQuery("");
            }}
          >
            <ArrowLeft size={15} />
            {subject ? "基础资产" : "资产库"}
          </button>
          <h3>
            {selectedGroup?.name ||
              categories.find((c) => c.id === category)?.title}
          </h3>
          <label className="studio-search">
            <Search size={15} />
            <input
              aria-label="搜索当前资产分类"
              placeholder="搜索当前分类"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <p className="studio-muted">
          资料按用途归位。每份成果保留状态、来源与使用位置。
        </p>
      )}
      {!category && (
        <>
          {librarySections.map((section) => (
            <section
              className={`studio-library-section ${section.id}`}
              key={section.id}
              aria-label={section.title}
            >
              <h3>{section.title}</h3>
              <div className="studio-folder-grid">
                {section.categories.map(({ id, title, note, icon: Icon }) => (
                  <button
                    className="studio-folder-card"
                    key={id}
                    onClick={() => setCategory(id)}
                  >
                    <Icon size={26} />
                    <strong>{title}</strong>
                    <span>{note}</span>
                    <footer>
                      {counts[id]} 项<ChevronRight size={15} />
                    </footer>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {category === "raw" && (
        <RawConversations projectId={project.id} query={query} />
      )}
      {(category === "images" || category === "trash") && (
        <ImageArchive
          images={project.imageLibrary ?? []}
          trash={category === "trash"}
          query={query}
          onRecycle={onRecycle}
          onOrganize={onOrganize}
          running={["queued", "running"].includes(project.run?.status ?? "")}
        />
      )}
      {category === "basis" && (
        <>
          <div className="studio-filter-row">
            {["全部", "人物", "场景", "道具"].map((name) => (
              <button
                key={name}
                className={subtype === name ? "active" : ""}
                onClick={() => {
                  setSubtype(name);
                  setSubject(null);
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="studio-muted">
            这里只收录最终验收通过的资产。未定稿与暂停图片请到
            <button
              onClick={() => {
                setCategory("images");
                setSubject(null);
                setQuery("");
              }}
            >
              图片记录
            </button>
            查看、交给总控整理。
          </p>
          {!subject &&
            ["人物", "场景", "道具"].map((kind) => {
              const items = groups.filter((group) => group.category === kind);
              return items.length ? (
                <section className="studio-subject-section" key={kind}>
                  <h4>
                    {kind}
                    <small>{items.length} 组</small>
                  </h4>
                  <div className="studio-subject-grid">
                    {items.map((group) => (
                      <button
                        className="studio-subject-card"
                        key={group.id}
                        onClick={() => setSubject(group.id)}
                      >
                        <Folder size={24} />
                        <strong>{group.name}</strong>
                        <span>
                          {group.assets.length} 项 ·{" "}
                          {group.assets.reduce(
                            (sum, item) => sum + imagesOf(item).length,
                            0,
                          )}{" "}
                          张图片
                        </span>
                        <small>
                          {
                            group.assets.filter(
                              (item) => item.status === "approved",
                            ).length
                          }{" "}
                          项已通过
                        </small>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null;
            })}
          {subject && (
            <div className="studio-asset-grid">
              {visibleAssets.map((a) => {
                const images = imagesOf(a);
                return (
                  <button
                    className="studio-asset-card"
                    key={a.id}
                    onClick={() => setAsset(a)}
                  >
                    <div className="studio-asset-placeholder">
                      {images.length ? (
                        <>
                          <AssetThumbnail
                            key={images[0].url}
                            file={images[0]}
                          />
                          <span className="studio-asset-image-count">
                            <ImageIcon size={13} />
                            {images.length} 张图片
                          </span>
                        </>
                      ) : (
                        <>
                          <Folder size={32} />
                          <span>{a.category}设定 · 暂无图片</span>
                        </>
                      )}
                    </div>
                    <div>
                      <strong>{a.name}</strong>
                      <p>{a.description}</p>
                      <footer>
                        <small>v{a.version}</small>
                        <span
                          className={`studio-status ${outputStateTones[assetState(a)]}`}
                        >
                          {outputStateLabels[assetState(a)]}
                        </span>
                      </footer>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {!(subject ? visibleAssets : assetRows).length && (
            <div className="studio-empty">没有符合条件的资产</div>
          )}
        </>
      )}
      {category === "documents" && (
        <div className="studio-record-list">
          {tasks
            .filter(
              (t) =>
                t.text &&
                !["assets", "frames", "video", "assembly"].includes(t.kind) &&
                matches(t.title),
            )
            .map((t) => (
              <button key={t.id} onClick={() => onTask(t.id)}>
                <FileText size={18} />
                <span>
                  <strong>{t.title}</strong>
                  <small>v{t.revision} · 点击查看正文与历史</small>
                </span>
                <span
                  className={`studio-status ${outputStateTones[taskOutputState(t)]}`}
                >
                  {t.delivery === "approved"
                    ? "已确认"
                    : outputStateLabels[taskOutputState(t)]}
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
        </div>
      )}
      {category === "source" && (
        <div className="studio-record-list">
          {project.sources
            .filter((s) => matches(s.name))
            .map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  const source = files[`${project.id}/sources`]?.find(
                    (f) => f.id === s.id,
                  );
                  if (source) setFile(source);
                }}
              >
                <FileText size={18} />
                <span>
                  <strong>{s.name}</strong>
                  <small>原始文件 · {(s.size / 1024).toFixed(1)} KB</small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          {!project.sources.length && (
            <div className="studio-empty">
              本引导故事使用内置梗概，尚未上传原始文件。
            </div>
          )}
        </div>
      )}
      {(category === "frames" || category === "videos") && (
        <div className="studio-record-list">
          {category === "videos" && (
            <ExportFiles files={exports.filter((file) => matches(file.name))} />
          )}
          {tasks
            .filter(
              (t) =>
                (category === "frames"
                  ? t.kind === "frames"
                  : ["video", "assembly"].includes(t.kind)) &&
                files[`${project.id}/${t.id}`]?.length &&
                matches(`第${t.episode}集 ${t.title}`),
            )
            .map((t) => (
              <button key={t.id} onClick={() => onTask(t.id)}>
                {category === "frames" ? (
                  <ImageIcon size={18} />
                ) : (
                  <Video size={18} />
                )}
                <span>
                  <strong>
                    第 {t.episode} 集{t.shot ? ` · 镜头 ${t.shot}` : ""}
                  </strong>
                  <small>
                    {t.title} · {files[`${project.id}/${t.id}`].length} 个文件
                  </small>
                </span>
                <span
                  className={`studio-status ${outputStateTones[taskOutputState(t)]}`}
                >
                  {t.delivery === "approved"
                    ? "已验收"
                    : taskOutputState(t) === "paused"
                      ? "已暂停"
                      : "待验收"}
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          {counts[category] === 0 && (
            <div className="studio-empty">
              还没有{category === "frames" ? "镜头画面" : "视频成果"}
              ，可以从对应流程节点添加。
            </div>
          )}
        </div>
      )}
      {asset && (
        <StudioDialog title={asset.name} onClose={() => setAsset(null)}>
          <div className="studio-asset-meta">
            <span>
              {asset.id} · v{asset.version}
            </span>
            <span
              className={`studio-status ${outputStateTones[assetState(asset)]}`}
            >
              {outputStateLabels[assetState(asset)]}
            </span>
          </div>
          <h4>图片 · {imagesOf(asset).length} 张</h4>
          {imagesOf(asset).length ? (
            <div className="studio-asset-images">
              {imagesOf(asset).map((f) => (
                <button
                  key={f.id ?? f.url}
                  className="studio-asset-image-button"
                  aria-label={`放大查看${f.name}`}
                  onClick={() => setFile(f)}
                >
                  <AssetThumbnail key={f.url} file={f} />
                  <span>{f.name}</span>
                  <small>点击查看原图</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="studio-muted">此资产尚未关联图片文件。</p>
          )}
          <h4>资产说明</h4>
          <ChatMarkdown text={asset.description} />
          {asset.taskId && (
            <>
              <div className="studio-media-grid">
                {assetFiles(asset)
                  .filter((f) => !f.type.startsWith("image/"))
                  .map((f) => (
                    <FilePreview key={f.id ?? f.url} file={f} zoomable />
                  ))}
              </div>
              <button
                onClick={() => {
                  setAsset(null);
                  onTask(asset.taskId!);
                }}
              >
                查看制作任务
                <ChevronRight size={12} />
              </button>
            </>
          )}
          <h4>来源</h4>
          <p>
            {asset.sourceIds.length
              ? asset.sourceIds.join("、")
              : "故事设定 · 原始设计"}
          </p>
          <h4>使用位置</h4>
          {tasks.filter((t) => t.assetIds.includes(asset.id)).length ? (
            tasks
              .filter((t) => t.assetIds.includes(asset.id))
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setAsset(null);
                    onTask(t.id);
                  }}
                >
                  第 {t.episode} 集 · 镜头 {t.shot}
                  <ChevronRight size={12} />
                </button>
              ))
          ) : (
            <p className="studio-muted">尚未被制作任务引用</p>
          )}
        </StudioDialog>
      )}
      {file && (
        <StudioDialog title={file.name} onClose={() => setFile(null)} wide>
          <FilePreview file={file} zoomable />
        </StudioDialog>
      )}
    </div>
  );
}

function AssetThumbnail({ file }: { file: MediaFile }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="studio-asset-image-fallback">
      <ImageIcon size={24} />
      图片加载失败，点击查看原图
    </span>
  ) : (
    <img
      src={file.url}
      alt={file.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
