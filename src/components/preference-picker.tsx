"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  PreferenceCategory,
  StoryPreference,
} from "@/shared/story-preferences";

/** A modal selection page; cancelling leaves the import form untouched. */
export function PreferencePicker({
  catalog,
  value,
  onClose,
  onApply,
}: {
  catalog: PreferenceCategory[];
  value: StoryPreference[];
  onClose: () => void;
  onApply: (next: StoryPreference[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState(() => value.map((p) => p.category));
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="preference-picker"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="preference-picker-body">
        <div className="panel-heading">
          <h2 id={titleId}>选择制作偏好</h2>
          <button type="button" aria-label="关闭偏好选择" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">先选想补充的类别，返回后再选择具体要求。</p>
        <div className="preference-category-grid">
          {catalog.map((category) => (
            <label className="preference-category-card" key={category.id}>
              <input
                type="checkbox"
                checked={selected.includes(category.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, category.id]
                      : selected.filter((id) => id !== category.id),
                  )
                }
              />
              <span>
                <strong>{category.label}</strong>
                <small>{category.description}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="preference-picker-footer">
          <small className="muted">已选 {selected.length} 项</small>
          <div>
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              onClick={() =>
                onApply(
                  catalog
                    .filter((c) => selected.includes(c.id))
                    .map(
                      (c) =>
                        value.find((p) => p.category === c.id) ?? {
                          category: c.id,
                          option: c.options[0].value,
                          detail: "",
                        },
                    ),
                )
              }
            >
              完成选择
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
