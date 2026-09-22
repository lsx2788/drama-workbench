"use client";
import { useDeferredValue, useMemo, useState } from "react";
import { Search, LocateFixed } from "lucide-react";
import { StudioDialog } from "@/shared/ui/dialog";
import type { StudioProject } from "@/domain";
import {
  searchWorkflow,
  type FlowSearchKind,
  type FlowSearchResult,
} from "./search";

export function FlowSearch({
  project,
  onClose,
  onLocate,
}: {
  project: StudioProject;
  onClose: () => void;
  onLocate: (result: FlowSearchResult) => void;
}) {
  const [kind, setKind] = useState<FlowSearchKind>("episode");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const deferred = useDeferredValue(query);
  const matches = useMemo(
    () => searchWorkflow(project, kind, deferred),
    [project, kind, deferred],
  );
  return (
    <StudioDialog title="查找剧集与分镜" onClose={onClose}>
      <div className="studio-flow-search">
        <div className="studio-search-kinds" role="group" aria-label="查找类型">
          {(
            [
              ["episode", "剧集"],
              ["shot", "分镜"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setLimit(20);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="studio-flow-search-input">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="搜索剧集或分镜"
            value={query}
            autoFocus
            placeholder={
              kind === "episode"
                ? "集数、名称或内容关键词"
                : "镜头编号、关键词，或 10-3（第10集镜头3）"
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(20);
            }}
          />
        </label>
        <p className="studio-search-summary" role="status">
          {query !== deferred
            ? "正在查找…"
            : `找到 ${matches.length} ${kind === "episode" ? "集" : "个分镜"} · 包含已折叠内容`}
        </p>
        <div className="studio-flow-search-results">
          {matches.slice(0, limit).map((result) => (
            <button
              className="studio-search-result"
              key={result.id}
              onClick={() => onLocate(result)}
            >
              <span>
                <small>{result.location}</small>
                <strong>{result.title}</strong>
                {result.text && <p>{result.text.slice(0, 100)}</p>}
              </span>
              <LocateFixed size={17} aria-label="定位节点" />
            </button>
          ))}
          {!matches.length && (
            <p className="studio-search-empty">
              没有找到，试试编号、名称或其他关键词。
            </p>
          )}
          {matches.length > limit && (
            <button
              className="studio-search-more"
              onClick={() => setLimit((value) => value + 20)}
            >
              显示更多（还有 {matches.length - limit} 项）
            </button>
          )}
        </div>
      </div>
    </StudioDialog>
  );
}
