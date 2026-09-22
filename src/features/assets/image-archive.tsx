"use client";
import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { LibraryImage } from "@/domain/types";
import { StudioDialog } from "@/shared/ui/dialog";
import { FilePreview } from "@/shared/ui/file-preview";

export function ImageArchive({
  images,
  trash,
  query,
  onRecycle,
  onOrganize,
  running,
}: {
  images: LibraryImage[];
  trash: boolean;
  query: string;
  onRecycle: (
    fileId: string,
    action: "trash" | "restore",
    reason: string,
  ) => Promise<boolean>;
  onOrganize: () => Promise<boolean>;
  running: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = images.find((image) => image.file.id === selectedId);
  const items = images.filter(
    (image) =>
      !!image.trash === trash &&
      `${image.name} ${image.trash?.reason ?? ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const actors: Record<string, string> = {
    human: "你",
    coordinator: "总控 AI",
    executor: "制作 AI",
    reviewer: "审核 AI",
  };
  async function change(image: LibraryImage) {
    if (busy) return;
    setBusy(true);
    try {
      if (
        await onRecycle(
          image.file.id!,
          image.trash ? "restore" : "trash",
          image.trash ? "用户从垃圾篓恢复图片" : reason,
        )
      ) {
        setSelectedId(null);
        setReason("");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!trash && (
        <div className="studio-filter-row">
          <button
            className="studio-image-organize"
            disabled={running || organizing}
            onClick={async () => {
              setOrganizing(true);
              try {
                if (await onOrganize())
                  setNotice("已交给 AI 检查，整理结果将在总控讨论中说明。");
              } finally {
                setOrganizing(false);
              }
            }}
          >
            {organizing
              ? "正在提交…"
              : running
                ? "AI 正在处理中"
                : "让总控整理旧图与暂停资产"}
          </button>
          {notice && <span role="status">{notice}</span>}
        </div>
      )}
      <p className="studio-muted">
        {trash
          ? "图片原件与历史记录仍保留。恢复图片不会自动验收或恢复已清理的任务，需要继续制作时请让总控恢复任务。"
          : "包含未定稿与历史版本，不属于正式人物库。总控可清理不再需要的暂停资产；仍在使用或有参考价值的旧图会保留。"}
      </p>
      <div className="studio-image-archive">
        {items.map((image) => (
          <button
            className="studio-archive-card"
            key={image.file.id}
            onClick={() => {
              setSelectedId(image.file.id!);
              setReason("");
            }}
          >
            <img src={image.file.url} alt={image.name} loading="lazy" />
            <strong>{image.name}</strong>
            <small>
              v{image.revision} · {image.current ? "当前版本" : "历史版本"}
            </small>
            {image.trash && <span>{image.trash.reason}</span>}
          </button>
        ))}
      </div>
      {!items.length && (
        <div className="studio-empty">
          {trash ? "垃圾篓里还没有图片" : "没有符合条件的图片"}
        </div>
      )}
      {selected && (
        <StudioDialog
          title={selected.name}
          onClose={() => setSelectedId(null)}
          wide
        >
          <FilePreview file={selected.file} zoomable />
          <p className="studio-muted">
            生成于 {new Date(selected.createdAt).toLocaleString("zh-CN")} ·{" "}
            {selected.rulesVersion
              ? `规则版本 ${selected.rulesVersion}`
              : "未记录生成规则版本"}
          </p>
          {selected.trash ? (
            <>
              <p>
                <strong>移入原因：</strong>
                {selected.trash.reason}
              </p>
              <p className="studio-muted">
                {actors[selected.trash.actor] ?? selected.trash.actor} ·{" "}
                {new Date(selected.trash.time).toLocaleString("zh-CN")}
              </p>
              <button disabled={busy} onClick={() => void change(selected)}>
                <RotateCcw size={15} />
                {busy ? "正在恢复…" : "恢复图片"}
              </button>
            </>
          ) : (
            <div className="studio-recycle-form">
              <label htmlFor="image-trash-reason">不再需要的原因</label>
              <textarea
                id="image-trash-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={4000}
                placeholder="例如：旧三视图不符合当前 A-pose 要求，已有通过的新版本替代"
              />
              <button
                disabled={busy || !reason.trim()}
                onClick={() => void change(selected)}
              >
                <Trash2 size={15} />
                {busy ? "正在移入…" : "移入垃圾篓"}
              </button>
            </div>
          )}
        </StudioDialog>
      )}
    </>
  );
}
