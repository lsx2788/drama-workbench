"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, Search } from "lucide-react";
import type { Task } from "@/domain";

function category(task: Task): string {
  switch (task.kind) {
    case "source":
      return "原作资料";
    case "brief":
      return "制作需求";
    case "script":
    case "episode":
      return "剧本与分集";
    case "storyboard":
    case "board":
      return "分镜";
    case "assets":
      return task.assetCategory ? `${task.assetCategory}资产` : "基础资产包";
    case "frames":
      return "镜头画面";
    case "video":
    case "assembly":
      return "视频";
  }
}

const order = [
  "原作资料",
  "制作需求",
  "剧本与分集",
  "分镜",
  "人物资产",
  "场景资产",
  "道具资产",
  "基础资产包",
  "镜头画面",
  "视频",
];

export function ReferenceGroups({
  title,
  tasks,
  onTask,
}: {
  title: string;
  tasks: Task[];
  onTask: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = tasks.filter((task) =>
    `${task.title} ${category(task)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="studio-reference-section">
      <h4>
        {title}
        <small>{tasks.length} 项</small>
      </h4>
      {tasks.length > 5 && (
        <label className="studio-organize-search">
          <Search size={16} />
          <input
            aria-label={`搜索${title}`}
            placeholder="搜索名称或类别"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {tasks.length ? (
        order.map((label) => {
          const rows = visible.filter((task) => category(task) === label);
          return rows.length ? (
            <details
              className="studio-reference-group"
              key={label + query}
              open={!!query.trim()}
            >
              <summary>
                <Folder size={17} />
                <strong>{label}</strong>
                <small>{rows.length} 项</small>
                <ChevronDown className="studio-reference-chevron" size={16} />
              </summary>
              <div className="studio-reference-group-items">
                {rows.map((task) => (
                  <button
                    className="studio-reference-row"
                    key={task.id}
                    onClick={() => onTask(task.id)}
                  >
                    <span>{task.title}</span>
                    <small>v{task.revision}</small>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
            </details>
          ) : null;
        })
      ) : (
        <p className="studio-muted">暂无内容</p>
      )}
      {!!tasks.length && !visible.length && (
        <p className="studio-muted">没有匹配的内容。</p>
      )}
    </section>
  );
}
