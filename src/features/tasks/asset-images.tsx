"use client";
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import type { MediaFile, StudioProject, Task } from "@/domain";

export function AssetImageButton({
  file,
  onPreview,
}: {
  file: MediaFile;
  onPreview: (file: MediaFile) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="studio-task-asset-image"
      aria-label={`查看图片 ${file.name}`}
      onClick={() => onPreview(file)}
    >
      {failed ? (
        <span>
          <ImageIcon size={20} />
          图片加载失败，点击查看
        </span>
      ) : (
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span>{file.name}</span>
    </button>
  );
}

export function TaskAssetImages({
  project,
  task,
  attachments,
  onPreview,
}: {
  project: StudioProject;
  task: Task;
  attachments: MediaFile[];
  onPreview: (file: MediaFile) => void;
}) {
  const linked = project.assets.filter(
    (a) => task.assetIds.includes(a.id) && a.status === "approved",
  );
  const own = attachments.filter((f) => f.type.startsWith("image/"));
  return (
    <section
      className="studio-task-asset-gallery"
      aria-label="当前节点关联图片"
    >
      <h4>
        {task.shot !== undefined ? "当前分镜的基础资产" : "当前任务的资产图片"}
      </h4>
      <p className="studio-muted">
        展示已保存的资产关联及本节点图片；单项图片通过，不代表本节点整包已验收。
      </p>
      {!linked.length && !own.length && (
        <p className="studio-muted">
          尚未关联图片。下方可查看已通过资产，选择后保存才会关联到当前节点。
        </p>
      )}
      <div className="studio-task-asset-groups">
        {linked.map((asset) => (
          <article key={asset.id}>
            <header>
              <strong>{asset.name}</strong>
              <small>已关联 · 单项已通过 · v{asset.version}</small>
            </header>
            <div className="studio-task-asset-thumbnails">
              {(asset.files ?? [])
                .filter((f) => f.type.startsWith("image/"))
                .map((f) => (
                  <AssetImageButton
                    key={f.id ?? f.url}
                    file={f}
                    onPreview={onPreview}
                  />
                ))}
            </div>
            {!(asset.files ?? []).some((f) => f.type.startsWith("image/")) && (
              <p className="studio-muted">此资产没有图片文件</p>
            )}
          </article>
        ))}
        {!!own.length && (
          <article>
            <header>
              <strong>本节点图片</strong>
              <small>
                {task.delivery === "approved" ? "已验收" : "待验收"}
              </small>
            </header>
            <div className="studio-task-asset-thumbnails">
              {own.map((f) => (
                <AssetImageButton
                  key={f.id ?? f.url}
                  file={f}
                  onPreview={onPreview}
                />
              ))}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
