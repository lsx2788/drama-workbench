"use client";
import { useEffect, useState } from "react";
import { Download, FileText, ImageIcon, Video } from "lucide-react";
import type { MediaFile } from "@/domain";
import { ZoomableImage } from "./zoomable-image";
export function FilePreview({
  file,
  zoomable = false,
}: {
  file: File | MediaFile;
  zoomable?: boolean;
}) {
  const [url, setUrl] = useState(""),
    [text, setText] = useState(""),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false);
  const stored = "url" in file;
  useEffect(() => {
    const value = stored ? file.url : URL.createObjectURL(file);
    setUrl(value);
    return () => {
      if (!stored) URL.revokeObjectURL(value);
    };
  }, [stored, file.name, stored ? file.url : file]);
  async function load(start: number) {
    setBusy(true);
    try {
      const res = await fetch(
        `${(file as MediaFile).url}?preview=text&offset=${start}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setText((t) => (start ? t + data.text : data.text));
      setOffset(data.nextOffset);
      setMore(data.hasMore);
    } catch (e) {
      setText(e instanceof Error ? e.message : "预览失败");
      setMore(false);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setText("");
    setMore(false);
    if (stored && /\.(txt|md|docx)$/i.test(file.name)) void load(0);
  }, [stored, file.name, stored ? file.url : file]);
  return (
    <div className="studio-file-preview">
      {url && file.type.startsWith("video/") ? (
        <video src={url} controls playsInline preload="metadata" />
      ) : url && file.type.startsWith("image/") ? (
        zoomable ? (
          <ZoomableImage key={url} src={url} alt={file.name} />
        ) : (
          <img src={url} alt={file.name} />
        )
      ) : (
        <FileText size={28} />
      )}
      <a href={url || undefined} download={file.name}>
        <Download size={14} />
        {file.name}
      </a>
      {stored && file.width && file.height && (
        <small>
          原文件 {file.width} × {file.height} 像素
        </small>
      )}
      {text && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            textAlign: "left",
            maxHeight: "60vh",
            overflow: "auto",
            width: "100%",
          }}
        >
          {text}
        </pre>
      )}
      {busy ? (
        <small>正在读取…</small>
      ) : (
        more && <button onClick={() => load(offset)}>继续查看原文</button>
      )}
    </div>
  );
}
export function FileLabel({ file }: { file: File | MediaFile }) {
  const Icon = file.type.startsWith("video/")
    ? Video
    : file.type.startsWith("image/")
      ? ImageIcon
      : FileText;
  return (
    <>
      <Icon size={16} />
      <span>{file.name}</span>
      <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
    </>
  );
}
