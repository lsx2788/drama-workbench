"use client";
import { useEffect, useState } from "react";
import { api, str, list, type RecordData, type Workspace } from "@/client/api";
import { Panel, Badge } from "./ui";
import { StoryPreview } from "./story-preview";
import { SourceExcerpt } from "./source-excerpt";
export function EpisodeContent({
  p,
  unitId,
  w,
  onSelect,
}: {
  p: string;
  unitId: string;
  w: Workspace;
  onSelect: (id: string) => void;
}) {
  const [episode, setEpisode] = useState<RecordData | null>(null),
    [error, setError] = useState("");
  const [excerpt, setExcerpt] = useState<RecordData | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setEpisode(null);
    setError("");
    api<RecordData>(`/projects/${p}/episodes/${unitId}`, { signal: c.signal })
      .then(setEpisode)
      .catch((err) => {
        if (!c.signal.aborted) setError(err.message);
      });
    return () => c.abort();
  }, [p, unitId]);
  if (error) return <p role="alert">{error}</p>;
  if (!episode) return <p>正在读取剧集资料…</p>;
  const units = w.sections
    .filter(
      (row) => row.workflow_id === episode.workflow_id && row.phase === "unit",
    )
    .sort((a, b) => Number(a.position) - Number(b.position));
  const index = units.findIndex((row) => row.id === unitId);
  return (
    <>
      <Panel title={`${str(episode, "code")} · 原始文案`}>
        {!!episode.summary && <p>{str(episode, "summary")}</p>}
        <p className="muted">原文引用保持原样。分集内的制作流程稍后讨论。</p>
        {list(episode.sources).map((source) => (
          <div className="episode-source" key={str(source, "id")}>
            <StoryPreview
              p={p}
              storyId={str(source, "story_id")}
              filename={str(source, "original_name")}
            />
            {!!source.locator && <p>{str(source, "locator")}</p>}
            {source.start_byte !== null && source.start_byte !== undefined && (
              <button onClick={() => setExcerpt(source)}>查看本集片段</button>
            )}
          </div>
        ))}
        {!list(episode.sources).length && (
          <p className="muted">尚未关联本集原文。</p>
        )}
      </Panel>
      {!!list(episode.assets).length && (
        <Panel title="引用的公共资产">
          {list(episode.assets).map((asset) => (
            <p key={str(asset, "version_id")}>
              {str(asset, "code")} · {str(asset, "name")} v
              {String(asset.version)} <Badge value={str(asset, "status")} />
            </p>
          ))}
        </Panel>
      )}
      <div className="episode-neighbours">
        <button
          disabled={index <= 0}
          onClick={() => onSelect(str(units[index - 1], "id"))}
        >
          上一集
        </button>
        <span>
          第 {String(episode.number)} 集 · {str(episode, "code")}
        </span>
        <button
          disabled={index < 0 || index >= units.length - 1}
          onClick={() => onSelect(str(units[index + 1], "id"))}
        >
          下一集
        </button>
      </div>
      <details className="episode-index">
        <summary>查看其他剧集</summary>
        <div>
          {units.map((unit) => (
            <button
              key={str(unit, "id")}
              onClick={() => onSelect(str(unit, "id"))}
              aria-pressed={unit.id === unitId}
            >
              {str(unit, "code")} · {str(unit, "name")}
            </button>
          ))}
        </div>
      </details>
      {excerpt && (
        <SourceExcerpt
          p={p}
          source={excerpt}
          key={str(excerpt, "id")}
          onClose={() => setExcerpt(null)}
        />
      )}
    </>
  );
}
