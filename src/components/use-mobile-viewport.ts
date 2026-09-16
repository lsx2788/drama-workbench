"use client";
import { useEffect, useRef } from "react";

/** Follow the visible viewport when the phone keyboard covers the layout viewport. */
export function useMobileViewport() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = root.current;
        if (!element || (viewport && viewport.scale !== 1)) return;
        const height = viewport?.height ?? window.innerHeight;
        element.style.setProperty("--visible-height", `${height}px`);
        element.style.setProperty(
          "--visible-top",
          `${viewport?.offsetTop ?? 0}px`,
        );
        const editing = document.activeElement?.matches(
          "textarea, input:not([type=button])",
        );
        element.classList.toggle(
          "mobile-keyboard",
          !!editing && (window.innerHeight - height > 120 || height < 500),
        );
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return root;
}
