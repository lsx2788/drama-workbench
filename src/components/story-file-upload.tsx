"use client";
import { useRef, useState } from "react";
import { FileText, ImageIcon, Upload, X } from "lucide-react";
import {
  STORY_EXTENSIONS,
  STORY_MAX_BYTES,
  STORY_FORMAT_ERROR,
  isStoryImageName,
} from "@/shared/story-import";

export function StoryFileUpload({
  file,
  disabled,
  onChange,
  onError,
}: {
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const select = (files: FileList) => {
    if (disabled || !files.length) return;
    if (files.length !== 1) return onError("每次只能上传一个故事文件");
    const next = files[0];
    const extension = next.name.slice(next.name.lastIndexOf(".")).toLowerCase();
    if (!STORY_EXTENSIONS.includes(extension))
      return onError(STORY_FORMAT_ERROR);
    if (!next.size || next.size > STORY_MAX_BYTES)
      return onError("故事文件不能为空，且不能超过 20 MB");
    onError("");
    onChange(next);
  };
  return (
    <div
      className={`story-upload ${dragging ? "dragging" : ""}`}
      role="region"
      aria-label="故事文件上传"
      aria-disabled={disabled}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled && e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        select(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        hidden
        disabled={disabled}
        accept={STORY_EXTENSIONS.join(",")}
        onChange={(e) => {
          if (e.target.files) select(e.target.files);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="story-upload-selected">
          {isStoryImageName(file.name) ? (
            <ImageIcon size={27} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <FileText size={27} strokeWidth={1.5} aria-hidden="true" />
          )}
          <div className="story-upload-file-info" role="status">
            <strong>{file.name}</strong>
            <small>
              {file.size < 1024
                ? `${file.size} B`
                : file.size < 1024 * 1024
                  ? `${(file.size / 1024).toFixed(1)} KB`
                  : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
            </small>
          </div>
          <div className="story-upload-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              重新选择
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label="移除文件"
              title="移除文件"
              onClick={() => {
                onChange(null);
                onError("");
                if (input.current) input.current.value = "";
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="story-upload-empty"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload size={25} strokeWidth={1.5} aria-hidden="true" />
          <strong>点击上传文件，或拖拽到这里</strong>
          <small>文档或图片 · 最大 20 MB</small>
          <small>TXT / Markdown / Word / PDF / PNG / JPG / WebP / GIF</small>
        </button>
      )}
      {file && <p className="story-upload-hint">也可以拖入其他文件替换</p>}
    </div>
  );
}
