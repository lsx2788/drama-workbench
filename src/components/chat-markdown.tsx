"use client";

import { memo, useId } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";

const components: Components = {
  a: ({ href, children, title }) =>
    href ? (
      <a
        href={href}
        title={title}
        target={href.startsWith("#") ? undefined : "_blank"}
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Uploaded and generated images keep their authenticated preview components.
  // Markdown image URLs are explicit links, never unsolicited remote requests.
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        图片：{alt || "查看图片"}
      </a>
    ) : (
      <span>{alt || "图片"}</span>
    ),
  table: ({ children }) => (
    <div
      className="chat-markdown-table"
      role="region"
      aria-label="消息表格"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};

/** Render stored text; never interpret embedded HTML or mutate the source. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
}: {
  text: string;
}) {
  const prefix = useId();
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkCjkFriendly]}
        remarkRehypeOptions={{ clobberPrefix: `message-${prefix}-` }}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
});
