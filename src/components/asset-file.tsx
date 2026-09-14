"use client";
import { useState } from "react";
import { str, type RecordData } from "@/client/api";

const fieldLabels: Record<string, string> = {
  name: "名称",
  demo: "演示资料",
  description: "说明",
  attributes: "属性",
  content: "内容",
  identity: "身份",
  visualRules: "形象要求",
  material: "材质",
  continuity: "连续性要求",
  text: "文字",
  appearance: "外观",
  code: "编号",
  light: "光线",
  layout: "布局",
  scene: "场景",
  period: "时段",
  assets: "所需资产",
  checklist: "制作清单",
  approval: "审核要求",
  requests: "需求",
  composite: "组合编号",
  reason: "原因",
  reuse: "复用规则",
  pose: "姿态",
  reusable: "可复用",
  shot: "镜号",
  seconds: "时长（秒）",
  frame: "画面",
  refs: "参考资产",
  prompt: "提示词",
  format: "格式",
  naming: "命名规则",
  checks: "检查项",
  narrator: "旁白",
  voices: "声线要求",
  tracks: "分轨",
  cue: "声音提示",
  inputs: "输入",
  rejection: "退回条件",
  retry: "重做规则",
  timeline: "时间线",
  subtitle: "字幕",
  outputs: "交付物",
  decision: "结论",
  package: "归档内容",
  age: "年龄",
  costume: "服装",
  personality: "性格",
  purpose: "用途",
};
function StructuredValue({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <ol>
        {value.map((v, i) => (
          <li key={i}>
            <StructuredValue value={v} />
          </li>
        ))}
      </ol>
    );
  if (value && typeof value === "object")
    return (
      <dl className="record-fields">
        {Object.entries(value).map(([k, v]) => (
          <div className="record-field" key={k}>
            <dt>{fieldLabels[k] ?? k}</dt>
            <dd>
              <StructuredValue value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span className="pre">
      {typeof value === "boolean"
        ? value
          ? "是"
          : "否"
        : String(value ?? "—")}
    </span>
  );
}
export function AssetFile({ file }: { file: RecordData }) {
  const [preview, setPreview] = useState<{ value: unknown }>();
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const mime = str(file, "mime"),
    url = str(file, "url");
  async function togglePreview() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (preview) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("文件暂时无法读取");
      const text = await response.text();
      const value: unknown =
        mime === "application/json" ? JSON.parse(text) : text;
      setPreview({
        value:
          value && typeof value === "object" && "content" in value
            ? value.content
            : value,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件暂时无法读取");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="record-file">
      {mime.startsWith("image/") && (
        <img
          className="asset-preview"
          src={url}
          alt={str(file, "original_name")}
        />
      )}
      {mime.startsWith("audio/") && <audio controls preload="none" src={url} />}
      {mime.startsWith("video/") && (
        <video
          controls
          preload="metadata"
          style={{ maxWidth: "100%" }}
          src={url}
        />
      )}
      <a href={url} target="_blank" rel="noreferrer">
        {str(file, "original_name")}
      </a>
      <small>{Math.ceil(Number(file.size) / 1024)} KB</small>
      {(mime === "application/json" || mime.startsWith("text/")) &&
        Number(file.size) <= 1024 * 1024 && (
          <button onClick={togglePreview} disabled={loading}>
            {loading ? "正在读取…" : open ? "收起内容" : "查看内容"}
          </button>
        )}
      {open && error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {open && preview && (
        <div style={{ width: "100%" }}>
          <StructuredValue value={preview.value} />
        </div>
      )}
    </div>
  );
}
