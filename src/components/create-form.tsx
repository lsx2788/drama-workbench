"use client";
import { useState } from "react";
import { api, str, type Workspace } from "@/client/api";
import { Dialog, Field } from "./ui";

import { fields, titles, endpoints, type FormKind } from "./form-config";
import { ReferencePicker } from "./reference-picker";
export type { FormKind } from "./form-config";
export function CreateForm({
  kind,
  workspace,
  projectId,
  onClose,
  onSaved,
  defaults = {},
}: {
  kind: FormKind;
  workspace?: Workspace;
  projectId: string;
  onClose: () => void;
  onSaved: (data: unknown) => void;
  defaults?: Record<string, string>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const spec = fields(kind, workspace);
  return (
    <Dialog title={titles[kind]} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            const fd = new FormData(e.currentTarget),
              body: Record<string, unknown> = {};
            for (const field of spec) {
              if (field.type === "multi") {
                body[field.key] = fd.getAll(field.key);
                continue;
              }
              const value = String(fd.get(field.key) ?? "");
              if (!value && field.optional) continue;
              body[field.key] =
                field.type === "json" ? JSON.parse(value || "[]") : value;
            }
            const result = await api(
              kind === "project"
                ? "/projects"
                : `/projects/${projectId}/${endpoints[kind]}`,
              { method: "POST", body: JSON.stringify(body) },
            );
            onSaved(result);
          } catch (err) {
            setError(err instanceof Error ? err.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        {spec.map((f) => (
          <Field key={f.key} label={f.label} group={f.type === "multi"}>
            {f.type === "multi" ? (
              <ReferencePicker name={f.key} options={f.options ?? []} />
            ) : f.type === "select" ? (
              <select
                name={f.key}
                required={!f.optional}
                defaultValue={defaults[f.key] ?? f.options?.[0]?.value}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "area" || f.type === "json" ? (
              <textarea
                name={f.key}
                rows={f.type === "json" ? 2 : 4}
                defaultValue={defaults[f.key] ?? f.initial}
                required={!f.optional}
              />
            ) : (
              <input
                name={f.key}
                defaultValue={defaults[f.key] ?? f.initial}
                required={!f.optional}
              />
            )}
          </Field>
        ))}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
