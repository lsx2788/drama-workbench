import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Store, Row } from "./db";
import {
  id,
  now,
  projectExists,
  requireRow,
  assert,
  audit,
  DomainError,
} from "./common";
import { assetSchema, versionSchema, reviewSchema } from "./schemas";

export function assetInProject(s: Store, p: string, key: string) {
  return requireRow(
    s.one("SELECT * FROM assets WHERE id=? AND project_id=?", key, p),
    "资产",
  );
}
export function versionInProject(s: Store, p: string, key: string) {
  return requireRow(
    s.one(
      "SELECT v.*,a.project_id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=? AND a.project_id=?",
      key,
      p,
    ),
    "资产版本",
  );
}
export function createAsset(s: Store, p: string, input: unknown) {
  projectExists(s, p);
  const d = assetSchema.parse(input),
    key = id();
  assert(
    !s.one("SELECT id FROM assets WHERE project_id=? AND code=?", p, d.code),
    "资产编号已存在",
  );
  s.run(
    "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?)",
    key,
    p,
    d.code,
    d.name,
    d.kind,
    d.description,
    JSON.stringify(d.attributes),
    d.entityKey,
    now(),
  );
  return assetInProject(s, p, key);
}
const filtersSchema = z
  .object({
    code: z.string().optional(),
    kind: assetSchema.shape.kind.optional(),
    entityKey: z.string().optional(),
    status: z.enum(["candidate", "approved", "rejected"]).optional(),
    attributes: assetSchema.shape.attributes.optional(),
  })
  .strict();
export function searchAssets(s: Store, p: string, filters: unknown = {}) {
  projectExists(s, p);
  const f = filtersSchema.parse(filters);
  let sql =
    "SELECT a.*, (SELECT MAX(version) FROM asset_versions WHERE asset_id=a.id AND status='approved') AS approved_version FROM assets a WHERE project_id=?";
  const args: (string | number)[] = [p];
  for (const [column, value] of [
    ["code", f.code],
    ["kind", f.kind],
    ["entity_key", f.entityKey],
  ])
    if (value !== undefined) {
      sql += ` AND a.${column}=?`;
      args.push(value);
    }
  if (f.status) {
    sql +=
      " AND EXISTS(SELECT 1 FROM asset_versions v WHERE v.asset_id=a.id AND v.status=?)";
    args.push(f.status);
  }
  for (const [key, value] of Object.entries(f.attributes ?? {})) {
    sql += " AND json_extract(a.attributes_json,?)=?";
    args.push(`$.${key}`, typeof value === "boolean" ? Number(value) : value);
  }
  return s.all(sql + " ORDER BY a.created_at DESC,a.code", ...args);
}
export function createVersion(
  s: Store,
  p: string,
  assetId: string,
  input: unknown,
) {
  assetInProject(s, p, assetId);
  const d = versionSchema.parse(input);
  return s.transaction(() => {
    for (const source of d.sources)
      assert(
        versionInProject(s, p, source).status === "approved",
        "来源必须是本项目已定稿版本",
      );
    const key = id(),
      next = Number(
        s.one(
          "SELECT COALESCE(MAX(version),0)+1 AS v FROM asset_versions WHERE asset_id=?",
          assetId,
        )?.v,
      );
    s.run(
      "INSERT INTO asset_versions VALUES(?,?,?,?,?,?,?)",
      key,
      assetId,
      next,
      "candidate",
      d.notes,
      "",
      now(),
    );
    for (const source of new Set(d.sources))
      s.run("INSERT INTO asset_sources VALUES(?,?)", key, source);
    return versionInProject(s, p, key);
  });
}
export function addFile(
  s: Store,
  p: string,
  versionId: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Row & { url: string } {
  assert(
    versionInProject(s, p, versionId).status === "candidate",
    "只有候选版本允许添加文件",
  );
  if (file.bytes.length === 0 || file.bytes.length > 50 * 1024 * 1024)
    throw new DomainError("FILE_SIZE", "文件大小应为 1 字节至 50 MB");
  const key = id(),
    diskKey = key + ".blob",
    location = path.join(s.root, "files", diskKey);
  writeFileSync(location, file.bytes, { flag: "wx" });
  try {
    s.transaction(() => {
      assert(
        versionInProject(s, p, versionId).status === "candidate",
        "该版本已被审核，请创建新版本",
      );
      s.run(
        "INSERT INTO files VALUES(?,?,?,?,?,?,?,?)",
        key,
        versionId,
        diskKey,
        path.basename(file.name).slice(0, 255),
        file.type || "application/octet-stream",
        file.bytes.length,
        createHash("sha256").update(file.bytes).digest("hex"),
        now(),
      );
    });
  } catch (error) {
    unlinkSync(location);
    throw error;
  }
  return {
    ...requireRow(s.one("SELECT * FROM files WHERE id=?", key), "文件"),
    url: `/api/v1/projects/${p}/files/${key}`,
  };
}
export function getFile(s: Store, p: string, key: string) {
  const file = requireRow(
    s.one(
      "SELECT f.* FROM files f JOIN asset_versions v ON v.id=f.version_id JOIN assets a ON a.id=v.asset_id WHERE f.id=? AND a.project_id=?",
      key,
      p,
    ),
    "文件",
  );
  const location = path.join(s.root, "files", String(file.file_key));
  if (!existsSync(location))
    throw new DomainError("FILE_MISSING", "元信息存在，但实际文件缺失", 409);
  return { file, bytes: readFileSync(location) };
}
export function reviewVersion(
  s: Store,
  p: string,
  key: string,
  input: unknown,
) {
  const d = reviewSchema.parse(input);
  return s.transaction(() => {
    assert(
      versionInProject(s, p, key).status === "candidate",
      "已审核版本不可重写，请创建新版本",
    );
    if (d.decision === "approved") {
      const files = s.all("SELECT * FROM files WHERE version_id=?", key);
      assert(files.length, "无实际文件，不能发布定稿");
      for (const file of files) {
        const { bytes } = getFile(s, p, String(file.id));
        assert(
          createHash("sha256").update(bytes).digest("hex") === file.sha256,
          "文件内容变化，不能发布",
        );
      }
    }
    const reviewId = id();
    s.run(
      "INSERT INTO reviews VALUES(?,?,?,?,?,?,?)",
      reviewId,
      key,
      "local-user",
      d.decision,
      d.scope,
      d.reason,
      now(),
    );
    s.run(
      "UPDATE asset_versions SET status=?,approval_scope=? WHERE id=?",
      d.decision,
      d.scope,
      key,
    );
    audit(s, p, "asset.reviewed", key, d);
    return versionInProject(s, p, key);
  });
}
export function assetDetail(s: Store, p: string, key: string) {
  const asset = assetInProject(s, p, key),
    versions = s.all(
      "SELECT * FROM asset_versions WHERE asset_id=? ORDER BY version DESC",
      key,
    );
  return {
    ...asset,
    attributes: JSON.parse(String(asset.attributes_json)),
    versions: versions.map(
      (
        v,
      ): Row & {
        files: (Row & { url: string })[];
        sources: Row[];
        reviews: Row[];
      } => ({
        ...v,
        files: s
          .all("SELECT * FROM files WHERE version_id=?", String(v.id))
          .map((f): Row & { url: string } => ({
            ...f,
            url: `/api/v1/projects/${p}/files/${f.id}`,
          })),
        sources: s.all(
          "SELECT a.code,a.name,v.id,v.version FROM asset_sources e JOIN asset_versions v ON v.id=e.source_version_id JOIN assets a ON a.id=v.asset_id WHERE e.version_id=?",
          String(v.id),
        ),
        reviews: s.all(
          "SELECT * FROM reviews WHERE version_id=?",
          String(v.id),
        ),
      }),
    ),
  };
}
export function lineage(s: Store, p: string, key: string) {
  versionInProject(s, p, key);
  const descendants = s.all(
    `WITH RECURSIVE descendants(id) AS (SELECT version_id FROM asset_sources WHERE source_version_id=? UNION SELECT e.version_id FROM asset_sources e JOIN descendants d ON e.source_version_id=d.id) SELECT v.id,v.version,a.code,a.name FROM descendants d JOIN asset_versions v ON v.id=d.id JOIN assets a ON a.id=v.asset_id`,
    key,
  );
  const ancestors = s.all(
    `WITH RECURSIVE ancestors(id) AS (SELECT source_version_id FROM asset_sources WHERE version_id=? UNION SELECT e.source_version_id FROM asset_sources e JOIN ancestors d ON e.version_id=d.id) SELECT v.id,v.version,a.code,a.name FROM ancestors d JOIN asset_versions v ON v.id=d.id JOIN assets a ON a.id=v.asset_id`,
    key,
  );
  return {
    ancestors,
    descendants,
    usages: s.all(
      "SELECT i.id,i.title,u.version_id FROM asset_usages u JOIN items i ON i.id=u.item_id WHERE u.version_id=?",
      key,
    ),
  };
}
