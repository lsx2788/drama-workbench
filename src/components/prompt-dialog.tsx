"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function PromptDialog({
  title,
  onClose,
  busy = false,
  closeLabel = "关闭设置",
  stacked = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  closeLabel?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`dialog prompt-dialog${stacked ? " prompt-dialog-stacked" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="prompt-dialog-content">
        <div className="panel-heading">
          <h2>{title}</h2>
          <button
            type="button"
            aria-label={closeLabel}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
