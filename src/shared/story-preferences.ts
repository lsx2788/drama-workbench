export interface PreferenceOption {
  value: string;
  label: string;
  detailLabel?: string;
}
export interface PreferenceCategory {
  id: string;
  label: string;
  description: string;
  options: readonly PreferenceOption[];
}

export interface StoryPreference {
  category: string;
  option: string;
  detail: string;
}
export function preferenceLabel(
  preference: StoryPreference,
  catalog: readonly PreferenceCategory[],
) {
  const category = catalog.find((c) => c.id === preference.category);
  const option = category?.options.find((o) => o.value === preference.option);
  return `${category?.label ?? preference.category}：${option?.label ?? preference.option}${preference.detail ? ` · ${preference.detail}` : ""}`;
}
