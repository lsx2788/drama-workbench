"use client";
import type {
  PreferenceCategory,
  StoryPreference,
} from "@/shared/story-preferences";

/** Inline category selection shares the form state without an overlay or confirmation. */
export function PreferencePicker({
  catalog,
  value,
  onChange,
}: {
  catalog: PreferenceCategory[];
  value: StoryPreference[];
  onChange: (next: StoryPreference[]) => void;
}) {
  return (
    <div
      className="preference-picker-inline"
      role="group"
      aria-label="选择制作偏好"
    >
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
                          option: "",
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
  );
}
