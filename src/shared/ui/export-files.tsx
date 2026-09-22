"use client";
import type { MediaFile } from "@/domain";
import { FilePreview } from "./file-preview";

export function ExportFiles({ files }: { files: MediaFile[] }) {
  if (!files.length) return null;
  return (
    <section className="studio-export-files" aria-label="预览与导出文件">
      <p className="studio-muted">
        点播放查看视频；点文件名下载原件或材料包。预览与导出文件不代表节点已验收。
      </p>
      {[...files]
        .sort(
          (a, b) =>
            Number(b.type.startsWith("video/")) -
            Number(a.type.startsWith("video/")),
        )
        .map((file) => (
          <article key={file.id ?? file.url}>
            <h4>{file.type.startsWith("video/") ? "视频预览" : "导出文件"}</h4>
            <FilePreview file={file} />
            <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
          </article>
        ))}
    </section>
  );
}
