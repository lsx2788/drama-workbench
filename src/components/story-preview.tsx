"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { StoryReader } from "./story-reader";

function PreviewDialog({
  p,
  storyId,
  filename,
  onClose,
}: {
  p: string;
  storyId: string;
  filename: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="story-preview-dialog"
      aria-label={filename}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div>
        <header className="story-preview-heading">
          <h2>{filename}</h2>
          <button type="button" aria-label="关闭预览" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="story-preview-body">
          <StoryReader p={p} storyId={storyId} compact />
        </div>
      </div>
    </dialog>
  );
}

export function StoryPreview({
  p,
  storyId,
  filename,
}: {
  p: string;
  storyId: string;
  filename: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="story-preview-file"
        onClick={() => setOpen(true)}
      >
        <FileText size={15} />
        <span>{filename}</span>
      </button>
      {open && (
        <PreviewDialog
          p={p}
          storyId={storyId}
          filename={filename}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
