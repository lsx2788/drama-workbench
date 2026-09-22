"use client";
import { useEffect, useRef, useState } from "react";
import { FileUp, Plus, X } from "lucide-react";
import { StudioDialog } from "@/shared/ui/dialog";
import { FileLabel } from "@/shared/ui/file-preview";

const preferences: Record<string, string[]> = {
  制作目标: ["分集剧本", "分镜", "视频成片"],
  制作范围: ["整个故事", "先做一部分", "指定片段"],
  画面风格: ["真人影视感", "2D 动漫", "3D 动画", "国风水墨", "绘本插画"],
  集数与时长: [
    "单条短片",
    "每集 1 分钟以内",
    "每集 1～3 分钟",
    "每集 3～5 分钟",
  ],
  画幅: ["竖屏 9:16", "横屏 16:9", "方形 1:1"],
  改编要求: ["忠实原文", "保留主线，压缩情节", "允许较大改编，先讨论"],
};
export function Intake({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (name: string, message: string, files: File[]) => Promise<boolean>;
}) {
  const [mode, setMode] = useState("file"),
    [files, setFiles] = useState<File[]>([]),
    [text, setText] = useState(""),
    [name, setName] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [picking, setPicking] = useState(false),
    [notes, setNotes] = useState(""),
    [library, setLibrary] = useState(false),
    [error, setError] = useState("");
  const [enabledPreferences, setEnabledPreferences] = useState<string[]>([]);
  const allPreferencesAdded =
    enabledPreferences.length === Object.keys(preferences).length;
  useEffect(() => {
    if (!picking || !allPreferencesAdded) return;
    const timer = window.setTimeout(() => setPicking(false), 700);
    return () => window.clearTimeout(timer);
  }, [picking, allPreferencesAdded]);
  const preferenceAnchor = useRef<HTMLDivElement>(null);
  const preferenceTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!picking) return;
    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !preferenceAnchor.current?.contains(event.target)
      ) {
        setPicking(false);
      }
    }
    function dismissEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPicking(false);
      preferenceTrigger.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape, true);
    };
  }, [picking]);
  const [preferenceOrder, setPreferenceOrder] = useState(
    Object.keys(preferences),
  );
  function addPreference(key: string) {
    setPreferenceOrder((current) => [
      ...current.filter((item) => item !== key),
      key,
    ]);
    setEnabledPreferences((current) =>
      current.includes(key) ? current : [...current, key],
    );
    preferenceTrigger.current?.focus({ preventScroll: true });
  }
  function removePreference(key: string) {
    setEnabledPreferences((current) => current.filter((item) => item !== key));
    setChoices((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([item]) => item !== key),
      ),
    );
  }
  const preferencePicker = (
    <section
      id="intake-preference-menu"
      className="studio-preference-menu"
      aria-label="添加制作偏好"
      data-open={picking}
      aria-hidden={!picking}
      inert={!picking}
    >
      <div className="studio-preference-picker">
        {Object.keys(preferences)
          .filter((key) => !enabledPreferences.includes(key))
          .map((key) => (
            <button key={key} onClick={() => addPreference(key)}>
              {key}
            </button>
          ))}
      </div>
      {allPreferencesAdded && (
        <small className="studio-muted" role="status">
          已全部添加
        </small>
      )}
    </section>
  );
  const add = (incoming: File[]) => {
    if (incoming.some((f) => f.size > 100 * 1024 * 1024)) {
      setError("单个文件请不超过 100 MB");
      return;
    }
    const firstFile = files[0] ?? incoming[0];
    if (firstFile)
      setName((current) =>
        current.trim() ? current : firstFile.name.replace(/\.[^.]+$/, ""),
      );
    setFiles((prev) => [
      ...prev,
      ...incoming.filter(
        (f) =>
          !prev.some(
            (p) =>
              p.name === f.name &&
              p.size === f.size &&
              p.lastModified === f.lastModified,
          ),
      ),
    ]);
    setError("");
  };
  async function create() {
    const submitted =
      mode === "text"
        ? [
            new File([text], `${name.trim() || "故事原文"}.txt`, {
              type: "text/plain",
            }),
          ]
        : files;
    const projectName =
      name.trim() || submitted[0]?.name.replace(/\.[^.]+$/, "") || "未命名故事";
    const message = `已提供：${submitted.map((f) => f.name).join("、")}。请先理解内容，再与我讨论制作方向。${
      Object.entries(choices).filter(([, v]) => v).length
        ? `\n\n初始偏好：\n${Object.entries(choices)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}：${v}`)
            .join("\n")}`
        : ""
    }${notes.trim() ? `\n\n我的想法：${notes.trim()}` : ""}`;
    if (await onCreate(projectName, message, submitted)) onClose();
    else setError("保存未完成，请查看页面错误提示后重试。");
  }
  return (
    <StudioDialog title="从一个故事开始" onClose={onClose} fixedTop>
      <p className="studio-muted">
        先保存原始材料，再与总控讨论制作方向。偏好可以留空。
      </p>
      <label className="studio-field">
        剧本名称
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="为这个故事起个名字"
        />
      </label>
      <div className="studio-detail-tabs">
        <button
          className={mode === "file" ? "active" : ""}
          onClick={() => setMode("file")}
        >
          上传文件
        </button>
        <button
          className={mode === "text" ? "active" : ""}
          onClick={() => setMode("text")}
        >
          粘贴文本
        </button>
        <button onClick={() => setLibrary(true)}>剧本库</button>
      </div>
      {mode === "file" ? (
        <>
          {!!files.length && (
            <section className="studio-import-selection" aria-label="已选文件">
              <p className="studio-muted" role="status">
                已选 {files.length} 个文件
              </p>
              <div className="studio-import-files">
                {files.map((f, i) => (
                  <div key={i}>
                    <FileLabel file={f} />
                    <button
                      aria-label={`移除 ${f.name}`}
                      onClick={() =>
                        setFiles((prev) => prev.filter((_, j) => i !== j))
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <label
            className="studio-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add([...e.dataTransfer.files]);
            }}
          >
            <FileUp size={30} />
            <strong>
              {files.length
                ? "继续添加文件，或拖到这里"
                : "点击上传，或把文件拖到这里"}
            </strong>
            <span>支持多份文档与参考图片</span>
            <input
              type="file"
              multiple
              hidden
              accept=".txt,.md,.doc,.docx,.pdf,image/*"
              onChange={(e) => {
                add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </label>
        </>
      ) : (
        <textarea
          aria-label="故事原文"
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴故事文本，将原样保存为文本文件…"
        />
      )}
      <div className="studio-preference-heading" ref={preferenceAnchor}>
        <h4>
          <button
            ref={preferenceTrigger}
            aria-label="选择制作偏好"
            aria-expanded={picking}
            aria-controls="intake-preference-menu"
            onClick={() => setPicking((current) => !current)}
          >
            <span>制作偏好</span>
            <Plus size={16} />
          </button>
        </h4>
        {preferencePicker}
      </div>
      <div>
        {!enabledPreferences.length && (
          <small className="studio-muted">有想法就选，没有也可以先聊。</small>
        )}
        {preferenceOrder.map((key) => {
          const options = preferences[key];
          const visible = enabledPreferences.includes(key);
          return (
            <div
              key={key}
              className="studio-preference-reveal"
              data-visible={visible}
              aria-hidden={!visible}
              inert={!visible}
            >
              <div>
                <fieldset className="studio-preference-group">
                  <legend>
                    {key}
                    <button
                      className="studio-preference-remove"
                      aria-label={`移除${key}偏好`}
                      onClick={() => removePreference(key)}
                    >
                      <X size={13} />
                    </button>
                  </legend>
                  <div>
                    {options.map((option) => (
                      <button
                        type="button"
                        aria-pressed={choices[key] === option}
                        className={choices[key] === option ? "selected" : ""}
                        key={option}
                        onClick={() =>
                          setChoices((prev) => ({
                            ...prev,
                            [key]: prev[key] === option ? "" : option,
                          }))
                        }
                      >
                        {option}
                      </button>
                    ))}
                    <input
                      aria-label={`自定义${key}`}
                      placeholder="其他，自定义输入"
                      value={
                        options.includes(choices[key])
                          ? ""
                          : (choices[key] ?? "")
                      }
                      onChange={(e) =>
                        setChoices((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                    />
                  </div>
                </fieldset>
              </div>
            </div>
          );
        })}
      </div>
      <label className="studio-field">
        你的想法
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="希望保留的情节、喜欢的感觉，或者想先尝试的部分…"
        />
      </label>
      <p className="studio-muted">
        原件保存后交给总控按需理解；偏好作为首条聊天消息，不会直接变成定稿要求。
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="studio-primary studio-full"
        disabled={busy || (mode === "file" ? !files.length : !text.trim())}
        onClick={create}
      >
        保存故事，开始讨论
      </button>
      {library && (
        <StudioDialog title="剧本库" onClose={() => setLibrary(false)}>
          <div className="studio-empty">建设中</div>
        </StudioDialog>
      )}
    </StudioDialog>
  );
}
