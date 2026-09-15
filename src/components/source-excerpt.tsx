"use client";
import { useEffect, useState } from "react";
import { api, str, type RecordData } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";

export function SourceExcerpt({
  p,
  source,
  onClose,
}: {
  p: string;
  source: RecordData;
  onClose: () => void;
}) {
  const [start, setStart] = useState(Number(source.start_byte));
  const [pages, setPages] = useState<Record<number, string>>({});
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      startByte: String(start),
      endByte: String(source.end_byte),
      encoding: String(source.encoding),
    });
    api<{ text: string; endByte: number; hasMore: boolean }>(
      `/projects/${p}/stories/${source.story_id}/range?${query}`,
      { signal: c.signal },
    )
      .then((data) => {
        if (c.signal.aborted) return;
        setPages((previous) => ({ ...previous, [start]: data.text }));
        setNext(data.hasMore ? data.endByte : null);
      })
      .catch((err) => {
        if (!c.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [p, source, start]);
  return (
    <PromptDialog
      title={str(source, "locator") || "本集原文片段"}
      onClose={onClose}
    >
      <pre className="prompt-snapshot">
        {Object.entries(pages)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, text]) => text)
          .join("")}
      </pre>
      {loading && <p>正在读取…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && next !== null && (
        <button onClick={() => setStart(next)}>继续读取</button>
      )}
    </PromptDialog>
  );
}
