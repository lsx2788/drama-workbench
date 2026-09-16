"use client";
import { useState } from "react";
import { Folder, ChevronRight } from "lucide-react";
import { str, type Workspace, type RecordData } from "@/client/api";
import {
  groupProjectReferences,
  referenceCount,
  type ReferenceGroup,
  type ReferenceAsset,
} from "@/client/project-references";
import { Badge } from "./ui";
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
function ReferenceSection({
  group,
  confirmed,
  onRecord,
  onHighlight,
  onAsset,
}: {
  group: ReferenceGroup;
  confirmed: boolean;
  onRecord: (id: string) => void;
  onHighlight: (r: RecordData) => void;
  onAsset: (a: ReferenceAsset) => void;
}) {
  const count = referenceCount(group);
  if (!count) return null;
  const categories = [...new Set(group.assets.map((a) => a.record.category))];
  return (
    <section
      className={`reference-status-group ${confirmed ? "reference-confirmed" : "reference-discussing"}`}
      aria-label={confirmed ? "已确定" : "讨论中"}
    >
      <h3>
        <span>{confirmed ? "已确定" : "讨论中"}</span>
        <span>{count}</span>
      </h3>
      {group.records.map((r) => (
        <button
          className="reference-summary"
          key={str(r, "id")}
          onClick={() => onRecord(str(r, "id"))}
        >
          <span>
            <strong>{names[str(r, "kind")] ?? str(r, "title")}</strong>
            <Badge value={str(r, "decision") || "proposed"} />
          </span>
          <b>
            {str(r, "title")} · 第 {String(r.revision)} 版
          </b>
          <small>{str(r, "summary")}</small>
          {r.usable === true ? (
            <small>已审核可用</small>
          ) : (
            !!r.use_blocker && (
              <small>暂不可用于下一步：{str(r, "use_blocker")}</small>
            )
          )}
        </button>
      ))}
      {group.highlights.length > 0 && (
        <details className="reference-folder">
          <summary>
            讨论重点 <span>{group.highlights.length}</span>
          </summary>
          {group.highlights.map((r) => (
            <button
              className="reference-summary"
              key={str(r, "id")}
              onClick={() => onHighlight(r)}
            >
              <span>
                <strong>{str(r, "content")}</strong>
                <Badge value={str(r, "status")} />
              </span>
            </button>
          ))}
        </details>
      )}
      {categories.map((category) => (
        <details className="reference-folder" key={category}>
          <summary>
            {category}
            <span>
              {
                group.assets.filter((a) => a.record.category === category)
                  .length
              }
            </span>
          </summary>
          {group.assets
            .filter((a) => a.record.category === category)
            .map((a) => (
              <button
                className="reference-summary"
                key={str(a.version, "id")}
                onClick={() => onAsset(a)}
              >
                <span>
                  <strong>{a.record.name}</strong>
                  <Badge value={str(a.version, "status")} />
                </span>
                <b>第 {String(a.version.version)} 版</b>
                {!!a.version.notes && <small>{str(a.version, "notes")}</small>}
              </button>
            ))}
        </details>
      ))}
    </section>
  );
}

/** Group persisted facts by review state; never infer confirmation from prose. */
export function ProjectReferencePanel({
  w,
  p,
  sessionId,
}: {
  w: Workspace;
  p: string;
  sessionId?: string;
}) {
  const [folder, setFolder] = useState<
    "confirmed" | "discussing" | "sources" | null
  >(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [asset, setAsset] = useState<ReferenceAsset | null>(null);
  const [highlight, setHighlight] = useState<RecordData | null>(null);
  const { confirmed, discussing, sources } = groupProjectReferences(
    w,
    sessionId,
  );
  if (
    !referenceCount(confirmed) &&
    !referenceCount(discussing) &&
    !sources.length
  )
    return null;
  const actions = {
    onRecord: setRecordId,
    onHighlight: setHighlight,
    onAsset: setAsset,
  };
  return (
    <div className="reference-folder-library" aria-label="已有信息与资产">
      {(
        [
          {
            key: "confirmed",
            name: "已确定",
            count: referenceCount(confirmed),
          },
          {
            key: "discussing",
            name: "讨论中",
            count: referenceCount(discussing),
          },
          { key: "sources", name: "已保存资料", count: sources.length },
        ] as const
      )
        .filter((item) => item.count > 0)
        .map((item) => (
          <button
            key={item.key}
            className={`reference-folder-entry ${item.key}`}
            onClick={() => setFolder(item.key)}
          >
            <Folder size={24} strokeWidth={1.5} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.count} 项</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      {folder && (
        <PromptDialog
          title={
            folder === "confirmed"
              ? "已确定"
              : folder === "discussing"
                ? "讨论中"
                : "已保存资料"
          }
          closeLabel="关闭资料文件夹"
          onClose={() => setFolder(null)}
        >
          <div className="project-reference-scroll">
            {folder === "confirmed" && (
              <ReferenceSection group={confirmed} confirmed {...actions} />
            )}
            {folder === "discussing" && (
              <ReferenceSection
                group={discussing}
                confirmed={false}
                {...actions}
              />
            )}
            {folder === "sources" && (
              <section aria-label="已保存资料">
                <h3>
                  已保存资料 <span>{sources.length}</span>
                </h3>
                <div className="reference-sources">
                  {sources.map((r) => (
                    <StoryPreview
                      key={str(r, "id")}
                      p={p}
                      storyId={str(r, "id")}
                      filename={str(r, "original_name") || str(r, "title")}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </PromptDialog>
      )}
      {recordId && (
        <PreparationRecordDialog
          p={p}
          w={w}
          recordId={recordId}
          onClose={() => setRecordId(null)}
        />
      )}
      {asset && (
        <PromptDialog
          title={`${asset.record.name} · 第 ${asset.version.version} 版`}
          onClose={() => setAsset(null)}
        >
          <AssetRecord
            record={asset.record}
            versionId={str(asset.version, "id")}
            p={p}
            w={w}
          />
        </PromptDialog>
      )}
      {highlight && (
        <PromptDialog title="讨论重点" onClose={() => setHighlight(null)}>
          <Badge value={str(highlight, "status")} />
          <ChatMarkdown text={str(highlight, "content")} />
          {!!highlight.rationale && <p>{str(highlight, "rationale")}</p>}
        </PromptDialog>
      )}
    </div>
  );
}
