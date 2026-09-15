"use client";
import {
  STORY_PREFERENCE_CATALOG,
  type StoryPreference,
} from "@/shared/story-preferences";
import { Field } from "./ui";

export function StoryPreferences({
  value,
  onChange,
}: {
  value: StoryPreference[];
  onChange: (next: StoryPreference[]) => void;
}) {
  const update = (category: string, option: string, detail = "") =>
    onChange(
      value.map((p) =>
        p.category === category ? { category, option, detail } : p,
      ),
    );
  return (
    <section className="preference-library" aria-label="制作偏好库">
      <h3>
        制作偏好库 <small>可选</small>
      </h3>
      <p className="muted">
        选择想补充的类别，在下方填写对应选项。未选择的内容留到聊天里讨论。
      </p>
      {STORY_PREFERENCE_CATALOG.map((category) => {
        const selected = value.find((p) => p.category === category.id);
        const option = category.options.find(
          (o) => o.value === selected?.option,
        );
        return (
          <div
            className={`preference-category ${selected ? "selected" : ""}`}
            key={category.id}
          >
            <button
              type="button"
              className="preference-toggle"
              aria-expanded={!!selected}
              aria-controls={`preference-${category.id}`}
              onClick={() =>
                onChange(
                  selected
                    ? value.filter((p) => p.category !== category.id)
                    : [
                        ...value,
                        {
                          category: category.id,
                          option: "discuss",
                          detail: "",
                        },
                      ],
                )
              }
            >
              <span>
                <strong>{category.label}</strong>
                <small>{category.description}</small>
              </span>
              <span>{selected ? "取消选择 −" : "选择 ＋"}</span>
            </button>
            {selected && (
              <div
                id={`preference-${category.id}`}
                className="preference-options"
              >
                <Field label={`${category.label}选项`}>
                  <select
                    value={selected.option}
                    onChange={(e) => update(category.id, e.target.value)}
                  >
                    {category.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {option?.detailLabel && (
                  <Field label={option.detailLabel}>
                    <input
                      value={selected.detail}
                      maxLength={300}
                      required
                      onChange={(e) =>
                        update(category.id, selected.option, e.target.value)
                      }
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
