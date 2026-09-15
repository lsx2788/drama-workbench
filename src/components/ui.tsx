import type { ReactNode } from "react";
import { PromptDialog } from "./prompt-dialog";
import { labels } from "@/client/api";
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{labels[value] ?? value}</span>;
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark">◇</div>
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
  group = false,
}: {
  label: string;
  children: ReactNode;
  group?: boolean;
}) {
  if (group)
    return (
      <div className="field">
        <span>{label}</span>
        {children}
      </div>
    );
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <PromptDialog title={title} onClose={onClose} closeLabel="关闭">
      {children}
    </PromptDialog>
  );
}
export function date(value: unknown) {
  return new Date(String(value)).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
