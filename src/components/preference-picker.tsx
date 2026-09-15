"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  PreferenceCategory,
  StoryPreference,
} from "@/shared/story-preferences";

/** Controlled live selection; closing only dismisses the glass panel. */
export function PreferencePicker({
  catalog,
  value,
  onClose,
  onChange,
}: {
  catalog: PreferenceCategory[];
  value: StoryPreference[];
  onClose: () => void;
  onChange: (next: StoryPreference[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
          <h2 id={titleId}>制作偏好</h2>
          <button type="button" aria-label="关闭偏好选择" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="preference-category-grid">
          {catalog.map((category) => (
            <label className="preference-category-card" key={category.id}>
              <input
                type="checkbox"
                checked={value.some((p) => p.category === category.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [
                          ...value,
                          {
                            category: category.id,
                            option: category.options[0].value,
                            detail: "",
                          },
                        ]
                      : value.filter((p) => p.category !== category.id),
                  )
                }
              />
              <span>
                <strong>{category.label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
