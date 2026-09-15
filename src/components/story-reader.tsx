"use client";
import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { api, str, type RecordData } from "@/client/api";
import { decodeStoryText, isStoryText } from "@/client/story-text";

export function StoryReader({
  p,
  storyId,
  compact = false,
}: {
  p: string;
  storyId: string;
  compact?: boolean;
}) {
  const [detail, setDetail] = useState<RecordData>();
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [error, setError] = useState("");
  const [encoding, setEncoding] = useState("utf-8");
  useEffect(() => {
    const controller = new AbortController();
    setDetail(undefined);
    setBytes(undefined);
    setError("");
    setEncoding("utf-8");
    async function load() {
      const record = await api<RecordData>(
        `/projects/${p}/stories/${storyId}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setDetail(record);
      if (!isStoryText(str(record, "mime"))) return;
      const response = await fetch(str(record, "download_url"), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("原文读取失败，请稍后重试。");
      const content = await response.arrayBuffer();
      if (!controller.signal.aborted) setBytes(content);
    }
    load().catch((e) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "原文读取失败");
    });
    return () => controller.abort();
  }, [p, storyId]);
  const decoded = bytes ? decodeStoryText(bytes, encoding) : undefined;
  return (
    <article className="story-reader">
      <header className="story-reader-header">
        <div>
          {!compact && (
            <>
              <span className="story-reader-eyebrow">
                <FileText size={14} /> 故事原文
              </span>
              <h1>{detail ? str(detail, "title") : "原文浏览"}</h1>
            </>
          )}
          {detail && (
            <p>
              {str(detail, "original_name")} ·{" "}
              {Number(detail.size).toLocaleString()} 字节
            </p>
          )}
        </div>
        {detail && (
          <a
            className="story-reader-download"
            href={str(detail, "download_url")}
            download
          >
            <Download size={14} /> 下载原文
          </a>
        )}
      </header>
      {detail && !compact && (
        <div className="story-reader-path">
          <span>原文路径</span>
          <code>{str(detail, "download_url")}</code>
        </div>
      )}
      {detail?.source_kind === "file" && isStoryText(str(detail, "mime")) && (
        <label className="story-reader-encoding">
          显示编码
          <select
            value={encoding}
            onChange={(e) => setEncoding(e.target.value)}
          >
            <option value="utf-8">UTF-8</option>
            <option value="gb18030">GB18030 / GBK</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
          </select>
        </label>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !detail ? (
        <p className="muted">正在读取原文…</p>
      ) : !isStoryText(str(detail, "mime")) ? (
        <p className="muted">
          此文件保留原始格式，可下载浏览；网页暂支持 TXT 和 Markdown 原文。
        </p>
      ) : !decoded ? (
        <p className="muted">正在读取原文…</p>
      ) : decoded.error ? (
        <p role="alert" className="error">
          {decoded.error}
        </p>
      ) : (
        <pre className="story-reader-text" aria-label="故事原文正文">
          {decoded.text}
        </pre>
      )}
    </article>
  );
}
