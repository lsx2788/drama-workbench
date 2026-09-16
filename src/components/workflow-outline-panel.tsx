"use client";
import { str, type RecordData } from "@/client/api";
import { Empty } from "./ui";
import { WorkflowOutlineContent } from "./workflow-outline-preview";

export function WorkflowOutlinePanel({
  outlines,
  selectedId,
  onSelect,
}: {
  outlines: RecordData[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const selected = outlines.find((o) => o.id === selectedId) ?? outlines.at(-1);
  if (!selected)
    return (
      <section className="outline-workspace-panel">
        <Empty>流程大纲尚未生成。与总控讨论制作方向后，它会显示在这里。</Empty>
      </section>
    );
  return (
    <section className="outline-workspace-panel" aria-label="流程大纲">
      <header>
        <h2>{str(selected.content as RecordData, "title")}</h2>
        {outlines.length > 1 && (
          <label>
            草案版本
            <select
              value={str(selected, "id")}
              onChange={(e) => onSelect(e.target.value)}
            >
              {[...outlines].reverse().map((o) => (
                <option key={str(o, "id")} value={str(o, "id")}>
                  {str(o.content as RecordData, "title")} · 第{" "}
                  {String(o.revision)} 版
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <WorkflowOutlineContent key={str(selected, "id")} outline={selected} />
    </section>
  );
}
