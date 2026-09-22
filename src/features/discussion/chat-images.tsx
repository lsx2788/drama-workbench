"use client";
import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import type { MediaFile } from "@/domain";
import { StudioDialog } from "@/shared/ui/dialog";
import { FilePreview } from "@/shared/ui/file-preview";

function DraftImage({
  file,
  remove,
  disabled,
}: {
  file: File;
  remove: () => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="studio-chat-image-draft">
      {/\.(png|jpe?g|webp|gif)$/i.test(file.name) ? (
        <img src={url || undefined} alt={file.name} />
      ) : (
        <span className="studio-chat-file-label">
          <FileText size={22} />
          <span>{file.name}</span>
        </span>
      )}
      <button
        type="button"
        aria-label={`移除附件 ${file.name}`}
        disabled={disabled}
        onClick={remove}
      >
        <X size={14} />
      </button>
    </div>
  );
}
export function ChatImageDrafts({
  files,
  onRemove,
  disabled,
}: {
  files: File[];
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="studio-chat-image-drafts" aria-label="待发送附件">
      {files.map((file, index) => (
        <DraftImage
          key={`${file.name}-${file.lastModified}-${index}`}
          file={file}
          remove={() => onRemove(index)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
export function ChatImages({ files }: { files: MediaFile[] }) {
  const [selected, setSelected] = useState<MediaFile | null>(null);
  return (
    <>
      <div className="studio-chat-attachments">
        {files.map((file) => (
          <button
            key={file.id}
            onClick={() => setSelected(file)}
            aria-label={`查看上传附件 ${file.name}`}
            title={file.name}
          >
            {file.type.startsWith("image/") ? (
              <img src={file.url} alt={file.name} loading="lazy" />
            ) : (
              <span className="studio-chat-file-label">
                <FileText size={22} />
                <span>{file.name}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      {selected && (
        <StudioDialog title={selected.name} onClose={() => setSelected(null)}>
          <FilePreview file={selected} zoomable />
        </StudioDialog>
      )}
    </>
  );
}
