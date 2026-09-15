"use client";
import { useEffect, useRef, useState } from "react";
import { FileUp, AlignLeft, Library } from "lucide-react";
import { api, type RecordData } from "@/client/api";
import {
  STORY_EXTENSIONS,
  STORY_MAX_BYTES,
  STORY_MAX_CHARACTERS,
  createImportKey,
  type StoryDiscussion,
} from "@/shared/story-import";
import { Dialog, Field } from "./ui";
import { StoryPreferences } from "./story-preferences";
import {
  type PreferenceCategory,
  type StoryPreference,
} from "@/shared/story-preferences";

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
  const [source, setSource] = useState<"text" | "file" | "library">("file");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preferences, setPreferences] = useState<StoryPreference[]>([]);
  const [catalog, setCatalog] = useState<PreferenceCategory[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [ideas, setIdeas] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const saved = useRef<{ project: RecordData; story: RecordData } | null>(null);
  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");
    api<PreferenceCategory[]>("/story-preferences")
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((err) => {
        if (active)
          setCatalogError(err instanceof Error ? err.message : "选项加载失败");
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [catalogAttempt]);
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
          if (busy || source === "library") return;
          setError("");
          setBusy(true);
          try {
            for (const preference of preferences) {
              const option = catalog
                .find((c) => c.id === preference.category)
                ?.options.find((o) => o.value === preference.option);
              if (option?.detailLabel && !preference.detail.trim())
                throw new Error(`请${option.detailLabel}`);
            }
            if (!saved.current) {
              if (source === "text" && !text.trim())
                throw new Error("请粘贴故事正文");
              if (source === "file" && !file) throw new Error("请选择故事文件");
              if (
                file &&
                source === "file" &&
                (!file.size || file.size > STORY_MAX_BYTES)
              )
                throw new Error("故事文件不能为空，且不能超过 20 MB");
              const fingerprint = JSON.stringify([
                source,
                title,
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
              if (source === "file") form.set("file", file!);
              // FormData normalizes text field line endings. JSON preserves the submitted text.
              const body =
                source === "text"
                  ? JSON.stringify({
                      source,
                      title,
                      text,
                      importKey: attempt.current.key,
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
              { method: "POST", body: JSON.stringify({ preferences, ideas }) },
            );
            await onSaved({ ...stored, discussion });
          } catch (err) {
            setError(
              (saved.current
                ? "故事已保存，聊天交接尚未完成。选择和想法仍保留在本窗口，可重试，不会重复导入。 "
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
              aria-pressed={source === "file"}
              onClick={() => {
                setSource("file");
                setError("");
              }}
            >
              <FileUp size={14} aria-hidden="true" /> 选择文件
            </button>
            <button
              type="button"
              aria-pressed={source === "text"}
              onClick={() => {
                setSource("text");
                setError("");
              }}
            >
              <AlignLeft size={14} aria-hidden="true" /> 粘贴文本
            </button>
            <button
              type="button"
              aria-pressed={source === "library"}
              onClick={() => {
                setSource("library");
                setError("");
              }}
            >
              <Library size={14} aria-hidden="true" /> 剧本库
            </button>
          </div>
          {source === "library" ? (
            <div className="story-library-pending" role="status">
              <Library size={25} strokeWidth={1.4} aria-hidden="true" />
              <span>剧本库建设中</span>
            </div>
          ) : source === "text" ? (
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
        </fieldset>
        <fieldset className="story-import-fields" disabled={busy}>
          {catalogLoading ? (
            <p className="muted">正在加载制作偏好库…</p>
          ) : catalogError ? (
            <p role="alert" className="error">
              {catalogError}{" "}
              <button
                type="button"
                onClick={() => setCatalogAttempt((n) => n + 1)}
              >
                重试加载选项
              </button>
            </p>
          ) : (
            <StoryPreferences
              catalog={catalog}
              value={preferences}
              onChange={setPreferences}
            />
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
          <p className="muted">
            选择和想法会作为消息发给总控，具体制作要求在聊天中讨论确定。
          </p>
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
          <button className="primary" disabled={busy || source === "library"}>
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
