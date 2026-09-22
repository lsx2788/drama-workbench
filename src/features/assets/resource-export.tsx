"use client";
import { useState } from "react";
import type { MediaFile, StudioProject } from "@/domain";
import { resourceShots } from "@/domain/resource-package";
import { StudioDialog } from "@/shared/ui/dialog";

export function ResourceExport({
  project,
  files,
  onClose,
  onDownload,
}: {
  project: StudioProject;
  files: Record<string, MediaFile[]>;
  onClose: () => void;
  onDownload: (ids: string[], version: number) => Promise<void>;
}) {
  const shots = resourceShots(project, files),
    ready = shots.filter((shot) => !shot.issues.length);
  const [selected, setSelected] = useState(() =>
    ready.map((shot) => shot.board.id),
  );
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState("");
  const chosen = ready.filter((shot) => selected.includes(shot.board.id));
  const imageCount = new Set(
    chosen.flatMap((shot) => shot.files.map((file) => file.id)),
  ).size;
  const episodes = [...new Set(shots.map((shot) => shot.board.episode!))];
  return (
    <StudioDialog title="导出视频制作资源包" onClose={onClose} wide>
      <section className="studio-resource-export">
        <p>
          选择前期资源已齐备的镜头，下载 ZIP
          后可在其他工具制作视频，无需在本工作流生成视频。
        </p>
        <p className="studio-muted">
          包含分镜词、资产及正式修订说明、人物 / 场景 /
          道具原图和已有验收画面。未生成镜头画面不影响导出；未验收图片和垃圾篓不导出。
        </p>
        <div className="studio-export-summary">
          <strong>
            {ready.length} / {shots.length} 个已有镜头可导出
          </strong>
          <button
            disabled={busy || !ready.length}
            onClick={() =>
              setSelected(
                chosen.length === ready.length
                  ? []
                  : ready.map((shot) => shot.board.id),
              )
            }
          >
            {chosen.length === ready.length && ready.length
              ? "取消全选"
              : "选择全部就绪镜头"}
          </button>
        </div>
        {!shots.length && (
          <p className="studio-empty">
            还没有正式镜头。分镜词与关联基础资产验收后，即可在这里导出。
          </p>
        )}
        <div className="studio-export-list">
        {episodes.map((episode) => (
          <details
            key={episode}
            open={
              episodes.length <= 3 ||
              ready.some((shot) => shot.board.episode === episode)
            }
          >
            <summary>
              第 {episode} 集 ·{" "}
              {ready.filter((shot) => shot.board.episode === episode).length}{" "}
              个可导出
            </summary>
            {shots
              .filter((shot) => shot.board.episode === episode)
              .map((shot) => (
                <label
                  className={`studio-export-shot ${shot.issues.length ? "unavailable" : ""}`}
                  key={shot.board.id}
                >
                  <input
                    type="checkbox"
                    aria-label={`导出第${episode}集镜头${shot.board.shot}`}
                    disabled={busy || !!shot.issues.length}
                    checked={chosen.some(
                      (item) => item.board.id === shot.board.id,
                    )}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, shot.board.id]
                          : previous.filter((id) => id !== shot.board.id),
                      )
                    }
                  />
                  <span>
                    <strong>
                      镜头 {String(shot.board.shot).padStart(2, "0")} ·{" "}
                      {shot.board.title}
                    </strong>
                    <small>
                      {shot.issues.length
                        ? shot.issues.join("；")
                        : `前期已验收 · ${shot.files.length} 张关联图片`}
                    </small>
                    {!shot.issues.length &&
                      shot.warnings.map((warning) => (
                        <small key={warning}>{warning}</small>
                      ))}
                  </span>
                </label>
              ))}
          </details>
        ))}
        </div>
        <footer className="studio-export-footer">
          <span>
            已选 {chosen.length} 个镜头 · {imageCount}{" "}
            张原图（共享图片不重复打包）
          </span>
          <button
            className="studio-primary"
            disabled={busy || !chosen.length}
            onClick={async () => {
              setBusy(true);
              setFeedback("");
              try {
                await onDownload(
                  chosen.map((shot) => shot.board.id),
                  project.version!,
                );
                setFeedback("资源包已准备并发起下载，请查看浏览器下载列表。");
              } catch (error) {
                setFeedback(
                  error instanceof Error ? error.message : "导出失败，请重试",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在打包…" : "下载资源包 ZIP"}
          </button>
        </footer>
        {feedback && <p role="status">{feedback}</p>}
      </section>
    </StudioDialog>
  );
}
