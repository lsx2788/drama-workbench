"use client";
import { useRef, useState } from "react";
import { MessageCircleQuestion, SkipForward } from "lucide-react";
import { api, str, type RecordData } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";

function QuestionRow({
  question,
  onLocate,
  onSkip,
}: {
  question: RecordData;
  onLocate: () => void;
  onSkip: () => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [menu, setMenu] = useState(false);
  return (
    <div className="confirmation-row-wrap">
      <span className="confirmation-swipe-hint" aria-hidden="true">
        <SkipForward size={16} /> 跳过
      </span>
      <button
        type="button"
        className="confirmation-row"
        style={{ transform: `translateX(${offset}px)` }}
        aria-label={`定位问题：${str(question, "title")}`}
        onClick={() => {
          if (!suppressClick.current) onLocate();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") suppressClick.current = false;
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            setMenu(true);
          }
          if (e.key === "Escape") setMenu(false);
        }}
        onPointerDown={(e) => {
          suppressClick.current = false;
          setMenu(false);
          if (!e.isPrimary || e.pointerType === "mouse") return;
          start.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const dx = e.clientX - start.current.x,
            dy = e.clientY - start.current.y;
          if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
            start.current = null;
            setOffset(0);
            suppressClick.current = true;
            return;
          }
          if (Math.abs(dx) > 12) suppressClick.current = true;
          setOffset(Math.min(100, Math.max(0, dx)));
        }}
        onPointerUp={(e) => {
          const point = start.current;
          start.current = null;
          setOffset(0);
          if (
            point &&
            e.clientX - point.x >= 76 &&
            Math.abs(e.clientY - point.y) < 40
          ) {
            suppressClick.current = true;
            onSkip();
          }
        }}
        onPointerCancel={() => {
          start.current = null;
          setOffset(0);
          suppressClick.current = true;
        }}
      >
        <span>{str(question, "title")}</span>
        <small>查看原消息 →</small>
      </button>
      {menu && (
        <div
          className="confirmation-row-menu"
          role="menu"
          aria-label="问题操作"
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setMenu(false);
              onSkip();
            }}
          >
            <SkipForward size={14} /> 跳过此问题
          </button>
          <button type="button" role="menuitem" onClick={() => setMenu(false)}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatConfirmations({
  p,
  questions,
  onLocate,
  refresh,
}: {
  p: string;
  questions: RecordData[];
  onLocate: (messageId: string) => void;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const closeSkip = () => {
    setSkip(null);
    requestAnimationFrame(() =>
      listRef.current?.focus({ preventScroll: true }),
    );
  };
  const pending = questions.filter((q) => q.status === "pending");
  return (
    <>
      {pending.length > 0 && (
        <div className="confirmation-reminder">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`待确认问题 ${pending.length} 项`}
          >
            <MessageCircleQuestion size={14} /> 待确认 <b>{pending.length}</b>
          </button>
        </div>
      )}
      {open && (
        <PromptDialog
          title="待确认问题"
          closeLabel="关闭待确认问题"
          onClose={() => setOpen(false)}
        >
          <p className="muted confirmation-list-help">
            点击定位原消息。手机右滑、电脑右键可跳过。
          </p>
          <div className="confirmation-list" ref={listRef} tabIndex={-1}>
            {pending.map((q) => (
              <QuestionRow
                key={str(q, "id")}
                question={q}
                onLocate={() => {
                  setOpen(false);
                  requestAnimationFrame(() => onLocate(str(q, "message_id")));
                }}
                onSkip={() => {
                  setError("");
                  setSkip(q);
                }}
              />
            ))}
            {!pending.length && <p className="muted">暂时没有待确认问题。</p>}
          </div>
          {skip && (
            <PromptDialog
              title="跳过这个问题？"
              closeLabel="取消跳过"
              stacked
              busy={busy}
              onClose={closeSkip}
            >
              <p>{str(skip, "title")}</p>
              <p className="muted">
                跳过后不再提醒，原消息仍然保留。跳过不代表同意，也不会通过任何成果审核。
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="confirmation-actions">
                <button type="button" disabled={busy} onClick={closeSkip}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(
                        `/projects/${p}/confirmations/${str(skip, "id")}/skip`,
                        {
                          method: "POST",
                          body: JSON.stringify({ confirm: true }),
                        },
                      );
                      await refresh();
                      closeSkip();
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "跳过失败，请重试",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "处理中…" : "确认跳过"}
                </button>
              </div>
            </PromptDialog>
          )}
        </PromptDialog>
      )}
    </>
  );
}
