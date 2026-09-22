"use client";
import { useState } from "react";
import { ImageIcon, LoaderCircle, AlertCircle } from "lucide-react";
import type { Message } from "@/domain";
import { StudioDialog } from "@/shared/ui/dialog";
import { FilePreview } from "@/shared/ui/file-preview";

export function MessageImage({
  image,
}: {
  image: NonNullable<Message["image"]>;
}) {
  const [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false);
  const state =
    image.file?.trashed
      ? "已移入垃圾篓 · 可在资产库恢复"
      : image.status === "generating"
      ? "正在生成图片…"
      : image.status === "failed"
        ? "生成失败"
        : !image.current
          ? "历史图片"
          : image.delivery === "approved"
            ? "已验收 · 可使用"
            : image.delivery === "reviewed"
              ? "内部审核通过 · 待总控验收"
              : image.delivery === "returned"
                ? "已退回 · 待修改"
                : "已生成 · 待审核";
  return (
    <div
      className="studio-message-image"
      onContextMenu={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={`studio-image-state ${!image.file?.trashed && image.current && image.delivery === "approved" ? "approved" : ""}`}
        role="status"
      >
        {image.status === "generating" ? (
          <LoaderCircle size={16} className="studio-image-spinner" />
        ) : image.status === "failed" ? (
          <AlertCircle size={16} />
        ) : (
          <ImageIcon size={16} />
        )}
        <span>{state}</span>
      </div>
      {image.status === "failed" && (
        <p className="studio-run-error">
          {image.error || "没有返回图片，请重新发起生成。"}
        </p>
      )}
      {image.file && (
        <button
          type="button"
          className="studio-image-thumbnail"
          aria-label={`放大查看${image.name}`}
          onClick={() => setOpen(true)}
        >
          {failed ? (
            <span>缩略图加载失败，点击查看原图</span>
          ) : (
            <img
              src={image.file.url}
              alt={image.name}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          )}
          <span>点击查看原图</span>
        </button>
      )}
      {open && image.file && (
        <StudioDialog title={image.name} onClose={() => setOpen(false)} wide>
          <p className="studio-image-preview-state">{state}</p>
          <FilePreview file={image.file} zoomable />
        </StudioDialog>
      )}
    </div>
  );
}
