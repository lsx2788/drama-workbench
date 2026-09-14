import type { Option } from "./form-config";

export function ReferencePicker({
  name,
  options,
}: {
  name: string;
  options: Option[];
}) {
  return (
    <span className="reference-picker">
      {options.length ? (
        options.map((o) => (
          <label key={o.value}>
            <input type="checkbox" name={name} value={o.value} />
            <span>{o.label}</span>
          </label>
        ))
      ) : (
        <span className="muted">暂无可选内容，可稍后补充。</span>
      )}
    </span>
  );
}
