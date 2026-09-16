"use client";
import { useState } from "react";
import { str, type Workspace, type RecordData } from "@/client/api";
import { storyRecords, type StoryRecord } from "@/client/story-records";
import { Badge, Empty } from "./ui";
import { PromptDialog } from "./prompt-dialog";
import { StoryPreview } from "./story-preview";
import { PreparationRecordDialog } from "./preparation-records";
import { AssetRecord } from "./story-library";
import { ChatMarkdown } from "./chat-markdown";

const names: Record<string, string> = {
  overview: "原作概况",
  requirements: "需求与目标",
  framework: "改编框架",
};

/** Read existing authoritative records; do not infer facts from chat or parse originals. */
export function ProjectReferencePanel({ w, p }: { w: Workspace; p: string }) {
  const [recordId, setRecordId] = useState<string | null>(null);
  const [asset, setAsset] = useState<StoryRecord | null>(null);
  const [highlight, setHighlight] = useState<RecordData | null>(null);
  const records = w.preparationRecords ?? [];
  const current = records.filter(
    (r) => !records.some((next) => next.previous_id === r.id),
  );
  const assets = storyRecords(w).filter((r) => r.type === "asset");
  const categories = [...new Set(assets.map((r) => r.category))];
  const highlights = w.highlights.filter(
    (r) => !w.highlights.some((next) => next.supersedes_id === r.id),
  );
  return (
    <aside className="project-reference-panel" aria-label="已知信息与资产">
      <header>
        <h2>已知信息与资产</h2>
        <p>随讨论更新，点击查看详情</p>
      </header>
      <div className="project-reference-scroll">
        <section>
          <h3>已知信息</h3>
          {current.length ? (
            current.map((r) => (
              <button
                className="reference-summary"
                key={str(r, "id")}
                onClick={() => setRecordId(str(r, "id"))}
              >
                <span>
                  <strong>{names[str(r, "kind")] ?? str(r, "title")}</strong>
                  <Badge value={str(r, "decision") || "proposed"} />
                </span>
                <b>{str(r, "title")}</b>
                <small>{str(r, "summary") || "查看已保存的内容"}</small>
              </button>
            ))
          ) : (
            <p className="muted">总控保存的概况、需求和框架会显示在这里。</p>
          )}
        </section>
        {highlights.length > 0 && (
          <details className="reference-folder">
            <summary>
              讨论重点 <span>{highlights.length}</span>
            </summary>
            {highlights.map((r) => (
              <button
                className="reference-summary"
                key={str(r, "id")}
                onClick={() => setHighlight(r)}
              >
                <span>
                  <strong>{str(r, "content")}</strong>
                  <Badge value={str(r, "status")} />
                </span>
              </button>
            ))}
          </details>
        )}
        <section>
          <h3>
            原始资料 <span>{w.stories.length}</span>
          </h3>
          <div className="reference-sources">
            {w.stories.map((r) => (
              <StoryPreview
                key={str(r, "id")}
                p={p}
                storyId={str(r, "id")}
                filename={str(r, "original_name") || str(r, "title")}
              />
            ))}
          </div>
          {!w.stories.length && <p className="muted">暂无原始资料</p>}
        </section>
        <section>
          <h3>
            故事资产 <span>{assets.length}</span>
          </h3>
          {categories.length ? (
            categories.map((category) => (
              <details className="reference-folder" key={category}>
                <summary>
                  {category}
                  <span>
                    {assets.filter((r) => r.category === category).length}
                  </span>
                </summary>
                {assets
                  .filter((r) => r.category === category)
                  .map((r) => (
                    <button
                      className="reference-summary"
                      key={r.id}
                      onClick={() => setAsset(r)}
                    >
                      <span>
                        <strong>{r.name}</strong>
                        <Badge value={r.status} />
                      </span>
                      <small>{r.description || "查看文件与版本"}</small>
                    </button>
                  ))}
              </details>
            ))
          ) : (
            <Empty>人物、场景和图片等资产保存后，会按类别显示。</Empty>
          )}
        </section>
      </div>
      {recordId && (
        <PreparationRecordDialog
          p={p}
          w={w}
          recordId={recordId}
          onClose={() => setRecordId(null)}
        />
      )}
      {asset && (
        <PromptDialog title={asset.name} onClose={() => setAsset(null)}>
          <AssetRecord record={asset} p={p} w={w} />
        </PromptDialog>
      )}
      {highlight && (
        <PromptDialog title="讨论重点" onClose={() => setHighlight(null)}>
          <Badge value={str(highlight, "status")} />
          <ChatMarkdown text={str(highlight, "content")} />
          {!!highlight.rationale && <p>{str(highlight, "rationale")}</p>}
        </PromptDialog>
      )}
    </aside>
  );
}
