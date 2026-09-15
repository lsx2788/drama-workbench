"use client";
import { useEffect, useState } from "react";
import { api, str, type RecordData } from "@/client/api";
import { Dialog, Panel, date } from "./ui";
import { StoryLink } from "./story-link";

export function StorySource({ p, storyId }: { p: string; storyId: string }) {
  const [detail, setDetail] = useState<RecordData>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError("");
    api<RecordData>(`/projects/${p}/stories/${storyId}`)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [p, storyId]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!detail) return <p className="muted">正在读取保存记录…</p>;
  return (
    <>
      <p className="muted">
        {detail.source_kind === "text" ? "粘贴文本" : "上传文件"} ·{" "}
        {str(detail, "original_name")} · {date(detail.created_at)}
      </p>
      <StoryLink p={p} storyId={storyId}>
        浏览原文
        <small className="story-message-path">
          {str(detail, "download_url")}
        </small>
      </StoryLink>
      <dl className="record-fields">
        <dt>故事编号</dt>
        <dd>{str(detail, "id")}</dd>
        <dt>文件大小</dt>
        <dd>{Number(detail.size).toLocaleString()} 字节</dd>
      </dl>
    </>
  );
}

export function StorySources({
  p,
  stories,
  onImport,
}: {
  p: string;
  stories: RecordData[];
  onImport: () => void;
}) {
  const [selected, setSelected] = useState<RecordData>();
  return (
    <Panel
      title="原始故事"
      action={<button onClick={onImport}>导入故事</button>}
    >
      {!stories.length && (
        <p className="muted">粘贴文本或选择文件，先把故事保存下来。</p>
      )}
      {stories.map((s) => (
        <div className="story-source-row" key={str(s, "id")}>
          <button className="record-link" onClick={() => setSelected(s)}>
            {str(s, "title")}
          </button>
          <small className="muted">已保存 · {date(s.created_at)}</small>
        </div>
      ))}
      {selected && (
        <Dialog
          title={str(selected, "title")}
          onClose={() => setSelected(undefined)}
        >
          <StorySource p={p} storyId={str(selected, "id")} />
        </Dialog>
      )}
    </Panel>
  );
}
