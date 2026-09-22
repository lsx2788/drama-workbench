"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Minus, Plus, RotateCcw } from "lucide-react";
import { StudioDialog } from "./dialog";

type View = { scale: number; x: number; y: number };
const initial: View = { scale: 1, x: 0, y: 0 };

export function ZoomableImage({
  src,
  alt,
  onExitFullscreen,
}: {
  src: string;
  alt: string;
  onExitFullscreen?: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null);
  const current = useRef<View>(initial),
    fit = useRef({ width: 0, height: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [view, setView] = useState(initial),
    [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  function update(next: View) {
    const box = stage.current!;
    const maxX = Math.max(
      0,
      (fit.current.width * next.scale - box.clientWidth) / 2,
    );
    const maxY = Math.max(
      0,
      (fit.current.height * next.scale - box.clientHeight) / 2,
    );
    current.current = {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    setView(current.current);
  }
  function measure() {
    const box = stage.current,
      img = image.current;
    if (!box || !img?.naturalWidth) return;
    const ratio = Math.min(
      box.clientWidth / img.naturalWidth,
      box.clientHeight / img.naturalHeight,
      1,
    );
    fit.current = {
      width: img.naturalWidth * ratio,
      height: img.naturalHeight * ratio,
    };
    setSize(fit.current);
    update(initial);
  }
  function zoom(factor: number, clientX?: number, clientY?: number) {
    if (!fit.current.width) return;
    const box = stage.current!.getBoundingClientRect(),
      old = current.current;
    const scale = Math.max(1, Math.min(8, old.scale * factor));
    const x = clientX === undefined ? 0 : clientX - box.left - box.width / 2;
    const y = clientY === undefined ? 0 : clientY - box.top - box.height / 2;
    update({
      scale,
      x: x - ((x - old.x) * scale) / old.scale,
      y: y - ((y - old.y) * scale) / old.scale,
    });
  }
  useEffect(() => {
    const box = stage.current!;
    // A non-passive listener keeps the wheel from scrolling the dialog or zooming the page.
    const wheel = (event: WheelEvent) => {
      if (!fit.current.width) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? box.clientHeight
            : 1);
      zoom(
        Math.exp(-Math.max(-150, Math.min(150, delta)) * 0.002),
        event.clientX,
        event.clientY,
      );
    };
    box.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => {
      box.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, []);

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }
  return (
    <div className="studio-image-viewer">
      <div
        ref={stage}
        className={`studio-image-stage ${view.scale > 1 ? "zoomed" : ""} ${dragging ? "dragging" : ""}`}
        tabIndex={0}
        role="region"
        aria-label="图片预览，可滚轮缩放，放大后拖动"
        onDoubleClick={() => update(initial)}
        onKeyDown={(event) => {
          if (
            [
              "+",
              "=",
              "-",
              "0",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
            ].includes(event.key)
          ) {
            event.preventDefault();
            if (event.key === "0") update(initial);
            else if (["+", "=", "-"].includes(event.key))
              zoom(event.key === "-" ? 0.8 : 1.25);
            else
              update({
                ...current.current,
                x:
                  current.current.x +
                  (event.key === "ArrowLeft"
                    ? 40
                    : event.key === "ArrowRight"
                      ? -40
                      : 0),
                y:
                  current.current.y +
                  (event.key === "ArrowUp"
                    ? 40
                    : event.key === "ArrowDown"
                      ? -40
                      : 0),
              });
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || drag.current || current.current.scale <= 1)
            return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous || previous.id !== event.pointerId) return;
          update({
            ...current.current,
            x: current.current.x + event.clientX - previous.x,
            y: current.current.y + event.clientY - previous.y,
          });
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        {failed ? (
          <span>图片加载失败，可下载原图查看</span>
        ) : (
          <img
            ref={image}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={measure}
            onError={() => setFailed(true)}
            style={{
              width: size.width || undefined,
              height: size.height || undefined,
              visibility: size.width ? "visible" : "hidden",
              transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          />
        )}
      </div>
      <div className="studio-image-zoom-controls">
        <small>滚轮缩放 · 放大后拖动 · 双击复位</small>
        <div role="group" aria-label="图片缩放控制">
          <button
            type="button"
            aria-label="缩小图片"
            disabled={view.scale <= 1 || failed}
            onClick={() => zoom(0.8)}
          >
            <Minus size={16} />
          </button>
          <output aria-label="图片缩放比例">
            {Math.round(view.scale * 100)}%
          </output>
          <button
            type="button"
            aria-label="放大图片"
            disabled={view.scale >= 8 || failed}
            onClick={() => zoom(1.25)}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label="恢复图片适应窗口"
            onClick={() => update(initial)}
          >
            <RotateCcw size={15} />
            <span>复位</span>
          </button>
          <button
            type="button"
            aria-label={
              onExitFullscreen ? "退出图片全屏" : "在浏览器内全屏查看图片"
            }
            title={onExitFullscreen ? "退出全屏（Esc）" : "在浏览器内全屏查看"}
            onClick={onExitFullscreen ?? (() => setFullscreen(true))}
          >
            {onExitFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            <span>{onExitFullscreen ? "退出全屏" : "全屏"}</span>
          </button>
        </div>
      </div>
      {fullscreen && !onExitFullscreen && (
        <StudioDialog
          title={alt}
          onClose={() => setFullscreen(false)}
          className="studio-image-fullscreen"
        >
          <ZoomableImage
            src={src}
            alt={alt}
            onExitFullscreen={() => setFullscreen(false)}
          />
        </StudioDialog>
      )}
    </div>
  );
}
