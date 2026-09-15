"use client";
import { useRef, useState } from "react";
import { FileText, ImageIcon, Upload, X } from "lucide-react";
import {
  STORY_EXTENSIONS,
  STORY_MAX_BYTES,
  STORY_MAX_FILES,
  STORY_BATCH_MAX_BYTES,
  STORY_FORMAT_ERROR,
  isStoryImageName,
} from "@/shared/story-import";

export function StoryFileUpload({
  files,
  disabled,
  onChange,
  onError,
}: {
  files: File[];
  disabled: boolean;
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const select = (incoming: FileList) => {
    if (disabled || !incoming.length) return;
    const next = [...files];
    for (const file of Array.from(incoming)) {
      const extension = file.name
        .slice(file.name.lastIndexOf("."))
        .toLowerCase();
      if (!STORY_EXTENSIONS.includes(extension))
        return onError(`${file.name}：${STORY_FORMAT_ERROR}`);
      if (!file.size || file.size > STORY_MAX_BYTES)
        return onError(`${file.name}：文件不能为空，且不能超过 20 MB`);
      if (
        !next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        )
      )
        next.push(file);
    }
    if (next.length > STORY_MAX_FILES)
      return onError(`一次最多上传 ${STORY_MAX_FILES} 个文件`);
    if (next.reduce((sum, file) => sum + file.size, 0) > STORY_BATCH_MAX_BYTES)
      return onError("一次上传的文件总大小不能超过 50 MB");
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
        multiple
        hidden
        disabled={disabled}
        accept={STORY_EXTENSIONS.join(",")}
        onChange={(e) => {
          if (e.target.files) select(e.target.files);
          e.target.value = "";
        }}
      />
      {files.length > 0 ? (
        <>
          <div className="story-upload-list">
            {files.map((file, index) => (
              <div
                className="story-upload-selected"
                key={`${file.name}-${file.size}-${file.lastModified}`}
              >
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
                    aria-label={`移除 ${file.name}`}
                    title="移除文件"
                    onClick={() => {
                      onChange(files.filter((_, current) => current !== index));
                      onError("");
                      if (input.current) input.current.value = "";
                    }}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="story-upload-footer">
            <small role="status">
              已选 {files.length} 个文件 ·{" "}
              {(
                files.reduce((sum, file) => sum + file.size, 0) /
                1024 /
                1024
              ).toFixed(1)}{" "}
              MB
            </small>
            <button
              type="button"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              <Upload size={14} aria-hidden="true" /> 继续添加
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="story-upload-empty"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload size={25} strokeWidth={1.5} aria-hidden="true" />
          <strong>点击上传文件，或拖拽到这里</strong>
          <small>可多选文档或图片 · 单个最大 20 MB</small>
          <small>TXT / Markdown / Word / PDF / PNG / JPG / WebP / GIF</small>
        </button>
      )}
      <p className="story-upload-hint">
        最多 20 个文件，合计 50 MB
        {files.length > 0 ? " · 拖入文件可继续添加" : ""}
      </p>
    </div>
  );
}
