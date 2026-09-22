"use client";
import { useState } from "react";
import { FileText, ImageIcon, Paperclip } from "lucide-react";
import type { TaskReference } from "@/domain/types";
import { StudioDialog } from "@/shared/ui/dialog";
import { FilePreview } from "@/shared/ui/file-preview";

export function TaskReferences({
  references,
}: {
  references: TaskReference[];
}) {
  const [selected, setSelected] = useState<TaskReference | null>(null);
  if (!references.length) return null;
  return (
    <>
      <details className="studio-task-references">
        <summary>
          <Paperclip size={13} /> 任务参考 · {references.length} 份
        </summary>
        <div>
          {references.map((ref) => (
            <button key={ref.file.id} onClick={() => setSelected(ref)}>
              {ref.file.type.startsWith("image/") ? (
                <ImageIcon size={16} />
              ) : (
                <FileText size={16} />
              )}
              <span>
                <strong>{ref.file.name}</strong>
                <small>{ref.purpose}</small>
                <small>
                  {ref.source === "original"
                    ? "原始文件"
                    : `产出版本 v${ref.sourceRevision ?? "未知"}`}
                  {ref.file.trashed ? " · 已移入垃圾篓" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      </details>
      {selected && (
        <StudioDialog
          title={selected.file.name}
          onClose={() => setSelected(null)}
        >
          <p>{selected.purpose}</p>
          <FilePreview file={selected.file} zoomable />
        </StudioDialog>
      )}
    </>
  );
}
