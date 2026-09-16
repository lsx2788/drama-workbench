import { list, str, type RecordData, type Workspace } from "./api";
import { storyRecords, type StoryRecord } from "./story-records";

export interface ReferenceAsset {
  record: StoryRecord;
  version: RecordData;
}
export interface ReferenceGroup {
  records: RecordData[];
  highlights: RecordData[];
  assets: ReferenceAsset[];
}
function latestBy(rows: RecordData[], field: string, revision: string) {
  const latest = new Map<string, RecordData>();
  for (const row of rows) {
    const key = str(row, field);
    if (
      !latest.has(key) ||
      Number(row[revision]) > Number(latest.get(key)![revision])
    )
      latest.set(key, row);
  }
  return [...latest.values()];
}
export function groupProjectReferences(w: Workspace, sessionId?: string) {
  // The side pane is a projection of the full library, never another store.
  const library = storyRecords(w);
  const records = library
    .filter((r) => r.type === "preparation")
    .map((r) => r.source);
  const sources = library
    .filter((r) => r.type === "story")
    .map((r) => r.source);
  const highlights = library
    .filter((r) => r.type === "highlight")
    .map((r) => r.source)
    .filter(
      (r) =>
        r.status !== "superseded" &&
        !w.highlights.some((next) => next.supersedes_id === r.id),
    );
  const referencedVersions = new Set(
    w.messages
      .filter(
        (m) =>
          !sessionId ||
          m.session_id === sessionId ||
          (m.group as RecordData | undefined)?.group_id === sessionId,
      )
      .flatMap((m) => list(m.images).map((image) => str(image, "version_id"))),
  );
  const referencedAssets = new Set(
    (w.assetVersions ?? [])
      .filter((v) => referencedVersions.has(str(v, "id")))
      .map((v) => str(v, "asset_id")),
  );
  const assetRecords = new Map(
    library
      .filter(
        (r) =>
          r.type === "asset" &&
          (["character", "scene", "prop", "costume", "composite"].includes(
            str(r.source, "kind"),
          ) ||
            referencedAssets.has(r.id)),
      )
      .map((r) => [r.id, r]),
  );
  const versions = w.assetVersions ?? [];
  const approved = latestBy(
    versions.filter((v) => v.status === "approved"),
    "asset_id",
    "version",
  );
  const candidates = latestBy(
    versions.filter((v) => v.status === "candidate"),
    "asset_id",
    "version",
  ).filter(
    (v) =>
      !approved.some(
        (a) =>
          a.asset_id === v.asset_id && Number(a.version) > Number(v.version),
      ),
  );
  const assets = (rows: RecordData[]): ReferenceAsset[] =>
    rows.flatMap((v) => {
      const record = assetRecords.get(str(v, "asset_id"));
      return record ? [{ record, version: v }] : [];
    });
  const confirmed: ReferenceGroup = {
    // A proposed revision must not erase the last confirmed baseline.
    records: latestBy(
      records.filter((r) => r.decision === "confirmed"),
      "kind",
      "revision",
    ),
    highlights: highlights.filter((r) => r.status === "confirmed"),
    assets: assets(approved),
  };
  const discussing: ReferenceGroup = {
    records: latestBy(records, "kind", "revision").filter(
      (r) => r.decision !== "confirmed",
    ),
    highlights: highlights.filter((r) => r.status === "proposed"),
    assets: assets(candidates),
  };
  return { confirmed, discussing, sources };
}
export function referenceCount(group: ReferenceGroup) {
  return group.records.length + group.highlights.length + group.assets.length;
}
