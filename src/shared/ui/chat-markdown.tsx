"use client";

import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import { remarkMentions } from "./remark-mentions";

export function CopyableText({ children }: { children?: ReactNode }) {
  const content = useRef<HTMLPreElement>(null);
  const [feedback, setFeedback] = useState("");
  useEffect(() => setFeedback(""), [children]);
  return (
    <div className="chat-copyable-text">
      <div className="chat-copyable-toolbar">
        <span role="status">{feedback}</span>
        <button
          type="button"
          onClick={async (event) => {
            event.stopPropagation();
            try {
              await navigator.clipboard.writeText(
                content.current?.textContent ?? "",
              );
              setFeedback("已复制");
            } catch {
              setFeedback("复制失败，请选中文本复制");
            }
          }}
        >
          复制文本
        </button>
      </div>
      <pre ref={content}>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CopyableText>{children}</CopyableText>,
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
  mentionNames = [],
}: {
  text: string;
  mentionNames?: string[];
}) {
  const prefix = useId();
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[
          remarkGfm,
          remarkCjkFriendly,
          [remarkMentions, { names: mentionNames }],
        ]}
        remarkRehypeOptions={{ clobberPrefix: `message-${prefix}-` }}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
});
