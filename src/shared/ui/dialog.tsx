"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function StudioDialog({
  title,
  children,
  onClose,
  wide = false,
  fixedTop = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  fixedTop?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  const content = (
    <>
      <header>
        <h2>{title}</h2>
        <button aria-label="关闭窗口" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="studio-modal-body">{children}</div>
    </>
  );
  return createPortal(
    <dialog
      ref={ref}
      className={`studio-modal ${wide ? "wide" : ""} ${fixedTop ? "fixed-top" : ""} ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {content}
    </dialog>,
    document.body,
  );
}
