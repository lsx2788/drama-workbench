"use client";
import { useEffect, useState } from "react";
import { api, str, list, type Workspace, type RecordData } from "@/client/api";
import { Panel, Badge } from "./ui";
import { PromptDialog } from "./prompt-dialog";
import { StoryPreview } from "./story-preview";
import { storyRecords } from "@/client/story-records";
const kindNames: Record<string, string> = {
  overview: "原作概况",
  requirements: "需求与目标",
  framework: "改编框架",
};
export function PreparationRecords({
  w,
  p,
  kind,
}: {
  w: Workspace;
  p: string;
  kind?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const records = storyRecords(w)
    .filter((r) => r.type === "preparation")
    .map((r) => r.source)
    .filter((row) => !kind || row.kind === kind);
  if (!records.length) return null;
  return (
    <Panel title={kind ? kindNames[kind] : "前期成果"}>
      <div className="preparation-record-list">
        {records.map((row) => (
          <button
            key={str(row, "id")}
            onClick={() => setSelected(str(row, "id"))}
          >
            <strong>{str(row, "title")}</strong>
            <span>
              {kindNames[str(row, "kind")]} · v{String(row.revision)}
            </span>
            <Badge value={str(row, "decision") || "proposed"} />
            {records.some((next) => next.previous_id === row.id) && (
              <small>已有后续修订</small>
            )}
          </button>
        ))}
      </div>
      {selected && (
        <PreparationRecordDialog
          p={p}
          recordId={selected}
          w={w}
          onClose={() => setSelected(null)}
        />
      )}
    </Panel>
  );
}
export function PreparationRecordDialog({
  p,
  recordId,
  w,
  onClose,
}: {
  p: string;
  recordId: string;
  w: Workspace;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<RecordData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<RecordData>(`/projects/${p}/preparation-records/${recordId}`, {
      signal: c.signal,
    })
      .then(setRecord)
      .catch((err) => {
        if (!c.signal.aborted) setError(err.message);
      });
    return () => c.abort();
  }, [p, recordId]);
  const content = (record?.content ?? {}) as RecordData;
  return (
    <PromptDialog title={str(content, "title") || "前期成果"} onClose={onClose}>
      {error ? (
        <p role="alert">{error}</p>
      ) : !record ? (
        <p>正在读取…</p>
      ) : (
        <>
          <Badge value={str(record, "decision") || "proposed"} />
          <p className="pre">{str(content, "summary")}</p>
          {!!content.scope && (
            <p className="pre">范围：{str(content, "scope")}</p>
          )}
          {content.episodeCount || content.minutesPerEpisode ? (
            <p>
              计划 {String(content.episodeCount ?? "待讨论")} 集 · 每集{" "}
              {String(content.minutesPerEpisode ?? "待讨论")} 分钟
            </p>
          ) : null}
          <p className="pre">{str(content, "details")}</p>
          {Array.isArray(content.constraints) &&
            content.constraints.length > 0 && (
              <>
                <h3>约束</h3>
                <ul>
                  {content.constraints.map((item, index) => (
                    <li key={index}>{String(item)}</li>
                  ))}
                </ul>
              </>
            )}
          {Array.isArray(content.unresolved) &&
            content.unresolved.length > 0 && (
              <>
                <h3>待讨论问题</h3>
                <ul>
                  {content.unresolved.map((item, index) => (
                    <li key={index}>{String(item)}</li>
                  ))}
                </ul>
              </>
            )}
          {list(content.sources).map((source, index) => (
            <div key={index}>
              <StoryPreview
                p={p}
                storyId={str(source, "storyId")}
                filename={
                  str(
                    w.stories.find((story) => story.id === source.storyId) ??
                      {},
                    "original_name",
                  ) || "原始文件"
                }
              />
              <small>{str(source, "locator")}</small>
            </div>
          ))}
          {!!record.reason && (
            <p className="muted">确认意见：{str(record, "reason")}</p>
          )}
        </>
      )}
    </PromptDialog>
  );
}
