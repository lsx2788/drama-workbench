"use client";
import { useRef, useState } from "react";
import { api, type RecordData } from "@/client/api";
import {
  STORY_EXTENSIONS,
  STORY_MAX_BYTES,
  STORY_MAX_CHARACTERS,
  createImportKey,
  STORY_STYLES,
  type StoryStyle,
  type StoryDiscussion,
} from "@/shared/story-import";
import { Dialog, Field } from "./ui";

export function StoryImport({
  projectId,
  onClose,
  onSaved,
}: {
  projectId?: string;
  onClose: () => void;
  onSaved: (result: {
    project: RecordData;
    story: RecordData;
    discussion: StoryDiscussion;
  }) => void | Promise<void>;
}) {
  const [source, setSource] = useState<"text" | "file">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState<StoryStyle>("discuss");
  const [customStyle, setCustomStyle] = useState("");
  const [ideas, setIdeas] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const saved = useRef<{ project: RecordData; story: RecordData } | null>(null);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Dialog title={projectId ? "导入故事" : "从一个故事开始"} onClose={close}>
      <p className="muted">
        {projectId
          ? "保存原始故事，之后可以随时查看和下载。"
          : "先保存故事并创建项目，制作要求可以稍后讨论。"}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError("");
          setBusy(true);
          try {
            if (!saved.current) {
              if (source === "text" && !text.trim())
                throw new Error("请粘贴故事正文");
              if (source === "file" && !file) throw new Error("请选择故事文件");
              if (style === "other" && !customStyle.trim())
                throw new Error("请填写自定义风格");
              if (
                file &&
                source === "file" &&
                (!file.size || file.size > STORY_MAX_BYTES)
              )
                throw new Error("故事文件不能为空，且不能超过 20 MB");
              const fingerprint = JSON.stringify([
                source,
                title,
                style,
                style === "other" ? customStyle : "",
                ideas,
                source === "text"
                  ? text
                  : [file?.name, file?.size, file?.lastModified],
              ]);
              if (attempt.current?.fingerprint !== fingerprint)
                attempt.current = { fingerprint, key: createImportKey() };
              const form = new FormData();
              form.set("source", source);
              form.set("title", title);
              form.set("importKey", attempt.current.key);
              form.set("style", style);
              form.set("customStyle", style === "other" ? customStyle : "");
              form.set("ideas", ideas);
              if (source === "file") form.set("file", file!);
              // FormData normalizes text field line endings. JSON preserves the submitted text.
              const body =
                source === "text"
                  ? JSON.stringify({
                      source,
                      title,
                      text,
                      importKey: attempt.current.key,
                      style,
                      customStyle: style === "other" ? customStyle : "",
                      ideas,
                    })
                  : form;
              saved.current = await api(
                projectId
                  ? `/projects/${projectId}/stories`
                  : "/projects/import-story",
                { method: "POST", body },
              );
            }
            const stored = saved.current!;
            const discussion = await api<StoryDiscussion>(
              `/projects/${stored.project.id}/stories/${stored.story.id}/discussion`,
              { method: "POST", body: "{}" },
            );
            await onSaved({ ...stored, discussion });
          } catch (err) {
            setError(
              (saved.current
                ? "故事和想法已保存，进入总控聊天未完成。可重试，不会重复导入。 "
                : "") +
                (err instanceof Error ? err.message : "保存失败，请重试"),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          className="story-import-fields"
          disabled={busy || !!saved.current}
        >
          <Field label="故事名称（可选）">
            <input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                file ? file.name.replace(/\.[^.]+$/, "") : "例如：青禾剑录"
              }
            />
          </Field>
          <div
            className="story-input-options"
            role="group"
            aria-label="故事导入方式"
          >
            <button
              type="button"
              aria-pressed={source === "text"}
              onClick={() => setSource("text")}
            >
              粘贴文本
            </button>
            <button
              type="button"
              aria-pressed={source === "file"}
              onClick={() => setSource("file")}
            >
              选择文件
            </button>
          </div>
          {source === "text" ? (
            <Field label="故事正文">
              <textarea
                value={text}
                rows={12}
                maxLength={STORY_MAX_CHARACTERS}
                onChange={(e) => setText(e.target.value)}
                placeholder="把已有的故事粘贴到这里…"
                required
              />
              <small className="muted">
                {text.length.toLocaleString()} 字符 · 原文保存，不做改写
              </small>
            </Field>
          ) : (
            <Field label="故事文件">
              <input
                type="file"
                accept={STORY_EXTENSIONS.join(",")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="muted">
                支持 TXT、Markdown、Word、PDF，最大 20 MB。原文件直接保存。
              </p>
              {file && (
                <p className="story-file-selection">
                  已选择：{file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </Field>
          )}
          <Field label="想做什么风格？">
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as StoryStyle)}
            >
              {STORY_STYLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="muted">
              先表达意向，之后可以和总控一起调整。
            </small>
          </Field>
          {style === "other" && (
            <Field label="自定义风格">
              <input
                value={customStyle}
                maxLength={300}
                required
                onChange={(e) => setCustomStyle(e.target.value)}
                placeholder="描述你希望的画面风格，也可以举参考作品"
              />
            </Field>
          )}
          <Field label="我的想法（可选）">
            <textarea
              value={ideas}
              rows={3}
              maxLength={5000}
              onChange={(e) => setIdeas(e.target.value)}
              placeholder="例如：先做第一章，希望节奏紧凑，保留原作结局；也可以写参考作品或其他要求。"
            />
          </Field>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button type="button" onClick={close} disabled={busy}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "正在准备…"
              : saved.current
                ? "重试进入总控聊天"
                : "保存并与总控讨论"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
