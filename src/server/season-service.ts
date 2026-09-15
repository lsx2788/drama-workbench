import { z } from "zod";
import type { Store } from "./db";
import { assert, audit, id, now, requireRow } from "./common";

export function seasonInWorkflow(
  s: Store,
  workflowId: string,
  seasonId: string,
) {
  return requireRow(
    s.one(
      "SELECT * FROM workflow_seasons WHERE id=? AND workflow_id=?",
      seasonId,
      workflowId,
    ),
    "本流程的季",
  );
}

export function attachSectionToSeason(
  s: Store,
  workflowId: string,
  sectionId: string,
  seasonId: string,
) {
  seasonInWorkflow(s, workflowId, seasonId);
  requireRow(
    s.one(
      "SELECT id FROM workflow_sections WHERE id=? AND workflow_id=? AND phase='unit'",
      sectionId,
      workflowId,
    ),
    "本流程的分集/章节",
  );
  assert(
    !s.one(
      "SELECT section_id FROM section_seasons WHERE section_id=?",
      sectionId,
    ),
    "制作单元已经属于某一季，不能重复分配",
  );
  s.run("INSERT INTO section_seasons VALUES(?,?)", sectionId, seasonId);
}

const schema = z
  .object({
    workflowId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(30000).default(""),
    unitIds: z.array(z.string().uuid()).max(500).default([]),
  })
  .strict();

/** Seasons group units; they never copy sessions or alter execution dependencies. */
export function createSeason(s: Store, p: string, input: unknown) {
  const d = schema.parse(input);
  return s.transaction(() => {
    const workflow = requireRow(
      s.one(
        "SELECT * FROM workflows WHERE id=? AND project_id=?",
        d.workflowId,
        p,
      ),
      "流程",
    );
    assert(workflow.status !== "archived", "归档流程不能扩展");
    assert(
      !s.one(
        "SELECT id FROM workflow_seasons WHERE workflow_id=? AND name=?",
        d.workflowId,
        d.name,
      ),
      "同名季已存在",
    );
    const key = id();
    const position = Number(
      s.one(
        "SELECT COALESCE(MAX(position),-1)+1 AS n FROM workflow_seasons WHERE workflow_id=?",
        d.workflowId,
      )?.n,
    );
    s.run(
      "INSERT INTO workflow_seasons VALUES(?,?,?,?,?,?)",
      key,
      d.workflowId,
      d.name,
      d.description,
      position,
      now(),
    );
    for (const unitId of d.unitIds)
      attachSectionToSeason(s, d.workflowId, unitId, key);
    audit(s, p, "workflow.season_added", key, { unitIds: d.unitIds });
    return requireRow(s.one("SELECT * FROM workflow_seasons WHERE id=?", key));
  });
}
