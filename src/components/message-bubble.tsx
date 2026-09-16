"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Quote } from "lucide-react";
import { createLongPress } from "@/client/long-press";

const interactive = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("a,button,input,textarea,select,summary,[role=button]");

/** Right click / touch long press quote the exact message, never send it. */
export function MessageBubble({
  children,
  className,
  sender,
  onQuote,
  messageId,
  needsConfirmation = false,
}: {
  children: ReactNode;
  className: string;
  sender: string;
  onQuote: () => void;
  messageId?: string;
  needsConfirmation?: boolean;
}) {
  const article = useRef<HTMLElement>(null);
  const suppressClickUntil = useRef(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const show = (x: number, y: number) =>
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 172)),
      y: Math.max(8, Math.min(y, window.innerHeight - 64)),
    });
  const longPress = useMemo(
    () =>
      createLongPress((point) => {
        suppressClickUntil.current = Date.now() + 900;
        show(point.x, point.y);
      }),
    [],
  );
  useEffect(() => () => longPress.cancel(), [longPress]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  return (
    <>
      <article
        ref={article}
        className={className}
        data-message-id={messageId}
        tabIndex={0}
        aria-label={`${sender}的消息${needsConfirmation ? "，待确认，点击或按回车引用回复" : ""}`}
        aria-haspopup="menu"
        onContextMenu={(e) => {
          if (interactive(e.target)) return;
          e.preventDefault();
          longPress.cancel();
          const rect = e.currentTarget.getBoundingClientRect();
          show(e.clientX || rect.left + 20, e.clientY || rect.top + 20);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (needsConfirmation && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onQuote();
            return;
          }
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            show(rect.left + 20, rect.top + 20);
          }
        }}
        onPointerDown={(e) => {
          longPress.cancel();
          if (
            !e.isPrimary ||
            e.pointerType === "mouse" ||
            interactive(e.target)
          )
            return;
          longPress.start({ x: e.clientX, y: e.clientY });
        }}
        onPointerMove={(e) => {
          longPress.move({ x: e.clientX, y: e.clientY });
        }}
        onPointerUp={longPress.cancel}
        onPointerCancel={longPress.cancel}
        onClickCapture={(e) => {
          if (Date.now() < suppressClickUntil.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onClick={(e) => {
          if (
            needsConfirmation &&
            !interactive(e.target) &&
            !window.getSelection()?.toString() &&
            Date.now() >= suppressClickUntil.current
          )
            onQuote();
        }}
      >
        {children}
      </article>
      {menu &&
        createPortal(
          <div
            className="message-menu-backdrop"
            onPointerDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          >
            <div
              role="menu"
              aria-label="消息操作"
              className="message-context-menu"
              style={{ left: menu.x, top: menu.y }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Tab") {
                  e.preventDefault();
                  setMenu(null);
                  article.current?.focus({ preventScroll: true });
                }
              }}
            >
              <button
                type="button"
                autoFocus
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onQuote();
                }}
              >
                <Quote size={15} /> 引用
              </button>
            </div>
          </div>,
          article.current?.closest("dialog[open]") ?? document.body,
        )}
    </>
  );
}
