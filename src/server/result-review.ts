import { z } from "zod";
import type { Store } from "./db";
import {
  coordinatorSession,
  listPreparationRecords,
} from "./preparation-service";
import { knowledge } from "./knowledge-service";
import { reviewVersion } from "./asset-service";
import { reviewSchema } from "./schemas";
import { projectExists } from "./common";

export function pendingReviews(s: Store, p: string) {
  projectExists(s, p);
  const records = listPreparationRecords(s, p).filter(
    (r) => !r.decision && !r.has_newer_revision,
  );
  const proposals = knowledge(s, p).proposals.filter((r) => !r.decision);
  const assets = s.all(
    "SELECT v.id,v.asset_id,v.version,v.status,a.name AS title FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=? AND v.status='candidate' ORDER BY v.created_at",
    p,
  );
  return {
    records: records.slice(0, 100),
    knowledge: proposals.slice(0, 100),
    assets: assets.slice(0, 100),
    counts: {
      records: records.length,
      knowledge: proposals.length,
      assets: assets.length,
    },
    notice:
      "只列出待审核交付，每类最多100条；退回结果请按编号查看并交回修改。聊天表态不改变审核状态。",
  };
}

export function reviewAsset(
  s: Store,
  p: string,
  sessionId: string,
  versionId: string,
  input: unknown,
) {
  coordinatorSession(s, p, sessionId);
  const d = reviewSchema
    .extend({ reason: z.string().trim().min(1).max(5000) })
    .parse(input);
  return reviewVersion(s, p, versionId, d, sessionId);
}
