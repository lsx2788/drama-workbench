"use client";
import { useId, useState } from "react";
import type {
  PreferenceCategory,
  StoryPreference,
} from "@/shared/story-preferences";
import { Field } from "./ui";
import { PreferencePicker } from "./preference-picker";

export function StoryPreferences({
  catalog,
  value,
  onChange,
}: {
  catalog: PreferenceCategory[];
  value: StoryPreference[];
  onChange: (next: StoryPreference[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const groupId = useId();
  const update = (category: string, option: string, detail = "") =>
    onChange(
      value.map((p) =>
        p.category === category ? { category, option, detail } : p,
      ),
    );
  return (
    <section className="preference-library" aria-label="制作偏好">
      <div className="preference-heading">
        <h3>
          制作偏好 <small>可选</small>
        </h3>
        <button
          type="button"
          className="preference-add"
          onClick={() => setPicking(true)}
        >
          ＋ 选择偏好
        </button>
      </div>
      {value.map((selected) => {
        const category = catalog.find((c) => c.id === selected.category);
        if (!category) return null;
        const option = category.options.find(
          (o) => o.value === selected.option,
        );
        return (
          <div className="preference-selection" key={category.id}>
            <div className="preference-selection-heading">
              <h4 id={`${groupId}-${category.id}`}>{category.label}</h4>
              <button
                type="button"
                className="preference-remove"
                aria-label={`移除${category.label}`}
                onClick={() =>
                  onChange(value.filter((p) => p.category !== category.id))
                }
              >
                移除
              </button>
            </div>
            <div
              className="preference-choice-grid"
              role="radiogroup"
              aria-labelledby={`${groupId}-${category.id}`}
            >
              {category.options.map((choice) => (
                <label className="preference-choice" key={choice.value}>
                  <input
                    type="radio"
                    name={`${groupId}-${category.id}`}
                    value={choice.value}
                    checked={selected.option === choice.value}
                    onChange={() => update(category.id, choice.value)}
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
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
        );
      })}
      {picking && (
        <PreferencePicker
          catalog={catalog}
          value={value}
          onClose={() => setPicking(false)}
          onApply={(next) => {
            onChange(next);
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}
