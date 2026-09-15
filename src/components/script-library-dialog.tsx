"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Library } from "lucide-react";

export function ScriptLibraryDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="script-library-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="script-library-body">
        <div className="panel-heading">
          <h2 id={titleId}>剧本库</h2>
          <button type="button" aria-label="关闭剧本库" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="story-library-pending" role="status">
          <Library size={34} strokeWidth={1.3} aria-hidden="true" />
          <span>建设中</span>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
