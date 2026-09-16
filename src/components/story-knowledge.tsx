"use client";
import { useEffect, useState } from "react";
import { api, str, list, type Workspace, type RecordData } from "@/client/api";
import { PreparationRecords } from "./preparation-records";
import { Panel, Badge } from "./ui";
import { StoryPreview } from "./story-preview";
import { AssetFile } from "./asset-file";
import { PromptDialog } from "./prompt-dialog";

function EntityAssets({ p, ids }: { p: string; ids: string[] }) {
  const [versions, setVersions] = useState<RecordData[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    Promise.all(
      ids.map((version) =>
        api<RecordData>(`/projects/${p}/versions/${version}`, {
          signal: c.signal,
        }),
      ),
    )
      .then(setVersions)
      .catch((err) => {
        if (!c.signal.aborted) setError(err.message);
      });
    return () => c.abort();
  }, [p, ids]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {versions.map((version) => (
        <Panel
          key={str(version, "id")}
          title={`形象资产 · v${String(version.version)}`}
          action={<Badge value={str(version, "status")} />}
        >
          <p>{str(version, "notes")}</p>
          {list(version.files).map((file) => (
            <AssetFile key={str(file, "id")} file={file} />
          ))}
        </Panel>
      ))}
    </>
  );
}
export function StoryKnowledge({ w, p }: { w: Workspace; p: string }) {
  const [selected, setSelected] = useState<RecordData | null>(null);
  const data = w.knowledge;
  const entities = list(data?.entities),
    relations = list(data?.relations);
  const positions = new Map(
    entities.map((entity, index) => {
      const angle =
        (2 * Math.PI * index) / Math.max(entities.length, 1) - Math.PI / 2;
      return [
        str(entity, "code"),
        { x: 320 + Math.cos(angle) * 220, y: 230 + Math.sin(angle) * 160 },
      ];
    }),
  );
  return (
    <div className="story-knowledge">
      <PreparationRecords w={w} p={p} />
      {!!entities.length && (
        <Panel title="人物与知识关系">
          <>
            <svg
              className="knowledge-network"
              viewBox="0 0 640 460"
              role="group"
              aria-label="人物与知识关系网图"
            >
              {relations.map((relation) => {
                const from = positions.get(str(relation, "from")),
                  to = positions.get(str(relation, "to"));
                if (!from || !to) return null;
                return (
                  <g key={str(relation, "code")}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`关系：${relation.label} ${relation.period}`}
                      onClick={() => setSelected(relation)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(relation);
                        }
                      }}
                    >
                      <rect
                        x={(from.x + to.x) / 2 - 42}
                        y={(from.y + to.y) / 2 - 13}
                        width={84}
                        height={26}
                        rx={6}
                      />
                      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 4}>
                        {str(relation, "label")}
                      </text>
                    </g>
                  </g>
                );
              })}
              {entities.map((entity) => {
                const point = positions.get(str(entity, "code"))!;
                return (
                  <g
                    key={str(entity, "code")}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看${entity.name}`}
                    onClick={() => setSelected(entity)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(entity);
                      }
                    }}
                  >
                    <circle cx={point.x} cy={point.y} r={34} />
                    <text x={point.x} y={point.y + 4}>
                      {str(entity, "name")}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="knowledge-list">
              {entities.map((entity) => (
                <button
                  key={str(entity, "code")}
                  onClick={() => setSelected(entity)}
                >
                  {str(entity, "name")} <small>{str(entity, "role")}</small>
                </button>
              ))}
            </div>
            <div className="knowledge-list" aria-label="关系与适用阶段">
              {relations.map((relation) => (
                <button
                  key={str(relation, "code")}
                  onClick={() => setSelected(relation)}
                >
                  {str(
                    entities.find((entity) => entity.code === relation.from) ??
                      {},
                    "name",
                  )}{" "}
                  →{" "}
                  {str(
                    entities.find((entity) => entity.code === relation.to) ??
                      {},
                    "name",
                  )}{" "}
                  · {str(relation, "label")}
                  <small>{str(relation, "period")}</small>
                </button>
              ))}
            </div>
          </>
        </Panel>
      )}
      {!!list(data?.proposals).filter((row) => !row.decision).length && (
        <Panel title="待总控检查的增补">
          {list(data?.proposals)
            .filter((row) => !row.decision)
            .map((row) => (
              <p key={str(row, "id")}>
                <Badge value="proposed" /> {str(row, "summary")}
              </p>
            ))}
        </Panel>
      )}
      {selected && (
        <PromptDialog
          title={str(selected, "name") || str(selected, "label")}
          onClose={() => setSelected(null)}
        >
          <p>{str(selected, "role")}</p>
          <p className="pre">{str(selected, "description")}</p>
          {!!selected.period && <p>适用阶段：{str(selected, "period")}</p>}
          {list(selected.sources).map((source, index) => (
            <div key={index}>
              <StoryPreview
                p={p}
                storyId={str(source, "storyId")}
                filename={
                  str(
                    w.stories.find((story) => story.id === source.storyId) ??
                      {},
                    "original_name",
                  ) || "原始资料"
                }
              />
              <p>{str(source, "locator")}</p>
            </div>
          ))}
          {Array.isArray(selected.assetVersionIds) &&
            selected.assetVersionIds.length > 0 && (
              <EntityAssets p={p} ids={selected.assetVersionIds as string[]} />
            )}
        </PromptDialog>
      )}
    </div>
  );
}
