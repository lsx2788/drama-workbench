"use client";
import { useState } from "react";
import { list, str } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";

export function ChatImages({ images }: { images: unknown }) {
  const [selected, setSelected] = useState("");
  const rows = list(images);
  return (
    <div className="chat-images">
      {rows.map((file) => (
        <figure key={str(file, "id")}>
          <button
            type="button"
            onClick={() => setSelected(str(file, "url"))}
            aria-label="查看生成图片"
          >
            <img
              loading="lazy"
              src={str(file, "url")}
              alt="AI 生成的候选图片"
            />
          </button>
          <figcaption>
            候选图片 · 已存资产库{" "}
            <a href={str(file, "url")} download={str(file, "original_name")}>
              下载
            </a>
          </figcaption>
        </figure>
      ))}
      {selected && (
        <PromptDialog title="生成图片" onClose={() => setSelected("")}>
          <img
            className="chat-image-full"
            src={selected}
            alt="AI 生成的候选图片"
          />
        </PromptDialog>
      )}
    </div>
  );
}
