"use client";
import { useEffect, useRef } from "react";

/** CSS owns normal height; only an open keyboard may override it. */
export function useMobileViewport() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = root.current;
        if (!element) return;
        const height = viewport?.height ?? window.innerHeight;
        const editing = document.activeElement?.matches(
          "textarea, input:not([type=button]):not([type=checkbox]):not([type=radio])",
        );
        const keyboardOpen =
          !!editing &&
          window.matchMedia("(max-width: 700px)").matches &&
          (!viewport || viewport.scale === 1) &&
          window.innerHeight - height > 120;
        // Safari can retain a smaller visual viewport after navigation/keyboard dismissal.
        // Do not keep that stale height as an empty keyboard-sized area while reading.
        if (keyboardOpen)
          element.style.setProperty("--visible-height", `${height}px`);
        else element.style.removeProperty("--visible-height");
        element.classList.toggle("mobile-keyboard", keyboardOpen);
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return root;
}
