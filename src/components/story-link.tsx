"use client";
import { createContext, useContext, type ReactNode } from "react";

export const StoryNavigation = createContext<
  ((storyId: string) => void) | null
>(null);
export function StoryLink({
  p,
  storyId,
  children,
}: {
  p: string;
  storyId: string;
  children: ReactNode;
}) {
  const open = useContext(StoryNavigation);
  return (
    <a
      className="story-source-link"
      href={`/?project=${encodeURIComponent(p)}&story=${encodeURIComponent(storyId)}`}
      onClick={(event) => {
        if (
          !open ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        open(storyId);
      }}
    >
      {children}
    </a>
  );
}
