import { z } from "zod";
import type { Store, Row } from "./db";
import { assert, audit, id, now, requireRow, nodeInProject } from "./common";
import { createNode } from "./project-service";
import { createAgent, createSession } from "./collaboration-service";
import { createItem } from "./work-service";
import {
  assertProductionCanExpand,
  terminalNodes,
  workflowStructure,
} from "./workflow-structure";
import { attachSectionToSeason, seasonInWorkflow } from "./season-service";
const short = z.string().trim().min(1).max(200);
const sectionSchema = z
  .object({
    workflowId: z.string().uuid(),
    name: short,
    phase: z.enum(["preparation", "unit", "delivery"]),
    kind: z.enum(["shared", "episode", "chapter"]).default("shared"),
    seasonId: z.string().uuid().optional(),
  })
  .strict();
function workflow(s: Store, p: string, key: string) {
  return requireRow(
    s.one("SELECT * FROM workflows WHERE id=? AND project_id=?", key, p),
    "流程",
  );
}
function insertSection(s: Store, d: z.infer<typeof sectionSchema>): Row {
  assert(
    !s.one(
      "SELECT g.id FROM workflow_sections g LEFT JOIN section_seasons m ON m.section_id=g.id WHERE g.workflow_id=? AND g.name=? AND (g.phase<>'unit' OR ?<>'unit' OR m.season_id IS ?)",
      d.workflowId,
      d.name,
      d.phase,
      d.seasonId ?? null,
    ),
    "同名流程分组已存在",
  );
  assert(
    d.phase === "unit" ? d.kind !== "shared" : d.kind === "shared",
    "分集/章节必须属于制作分组，共用分组属于前期或汇总",
  );
  const key = id();
  if (d.seasonId) {
    assert(d.phase === "unit", "只有分集/章节可以归属某一季");
    seasonInWorkflow(s, d.workflowId, d.seasonId);
  }
  const position = Number(
    s.one(
      "SELECT COALESCE(MAX(position),-1)+1 AS n FROM workflow_sections WHERE workflow_id=? AND phase=?",
      d.workflowId,
      d.phase,
    )?.n,
  );
  s.run(
    "INSERT INTO workflow_sections VALUES(?,?,?,?,?,?,?)",
    key,
    d.workflowId,
    d.phase,
    d.kind,
    d.name,
    position,
    now(),
  );
  if (d.seasonId) attachSectionToSeason(s, d.workflowId, key, d.seasonId);
  if (
    d.phase === "unit" &&
    s.one(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='episode_entries'",
    )
  ) {
    const projectId = String(
      requireRow(
        s.one("SELECT project_id FROM workflows WHERE id=?", d.workflowId),
      ).project_id,
    );
    const serial = Number(
      s.one(
        "SELECT COALESCE(MAX(serial),0)+1 AS n FROM episode_entries WHERE project_id=?",
        projectId,
      )?.n,
    );
    s.run(
      "INSERT INTO episode_entries VALUES(?,?,?,?,?,?)",
      key,
      projectId,
      serial,
      null,
      "",
      null,
    );
  }
  return {
    ...requireRow(s.one("SELECT * FROM workflow_sections WHERE id=?", key)),
    season_id: d.seasonId ?? null,
  };
}
export function createSection(s: Store, p: string, input: unknown) {
  const d = sectionSchema.parse(input);
  assert(
    ["draft", "active"].includes(String(workflow(s, p, d.workflowId).status)),
    "归档流程不能增加分组",
  );
  return s.transaction(() => {
    if (d.phase === "unit") assertProductionCanExpand(s, d.workflowId);
    return insertSection(s, d);
  });
}
const unitSchema = z
  .object({
    workflowId: z.string().uuid(),
    name: short,
    kind: z.enum(["episode", "chapter"]),
    seasonId: z.string().uuid().optional(),
    dependencies: z.array(z.string().uuid()).max(100).optional(),
    steps: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
            name: short,
            objective: z.string().max(30000).default(""),
            dependencies: z.array(z.string()).max(50).default([]),
            ai: z
              .object({
                name: short,
                purpose: short,
                instructions: z.string().max(30000).default(""),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();
/** Expand a fresh unit atomically. It shares prerequisites, never sessions or result state. */
export function appendUnit(s: Store, p: string, input: unknown) {
  const d = unitSchema.parse(input);
  return s.transaction(() => {
    assert(
      ["draft", "active"].includes(String(workflow(s, p, d.workflowId).status)),
      "归档流程不能扩展",
    );
    assertProductionCanExpand(s, d.workflowId);
    for (const parent of d.dependencies ?? [])
      assert(
        nodeInProject(s, p, parent).workflow_id === d.workflowId,
        "依赖节点必须属于同一流程",
      );
    assert(
      !d.dependencies?.length || d.steps.length,
      "空分集暂不绑定步骤依赖，请在添加具体节点时明确前置关系",
    );
    const { nodes: grouped, edges } = workflowStructure(s, d.workflowId);
    const prep = grouped.filter(
      (n) => n.phase === "preparation" && n.node_type !== "coordinator",
    );
    const prepEnds = terminalNodes(prep, edges);
    const section = insertSection(s, {
      workflowId: d.workflowId,
      name: d.name,
      phase: "unit",
      kind: d.kind,
      seasonId: d.seasonId,
    });
    const nodes = new Map<string, string>(),
      items = new Map<string, string>();
    for (const step of d.steps) {
      assert(!nodes.has(step.key), "分集内步骤标识不能重复");
      assert(
        step.dependencies.every((key) => nodes.has(key)),
        "依赖必须引用本分集中已声明的前置步骤",
      );
      const parents = step.dependencies.length
        ? step.dependencies.map((key) => nodes.get(key)!)
        : (d.dependencies ?? prepEnds.map((n) => String(n.id)));
      const node = createNode(s, p, {
        workflowId: d.workflowId,
        sectionId: section.id,
        name: step.name,
        objective: step.objective,
        dependencies: parents,
      })!;
      const nodeId = String(node.id);
      nodes.set(step.key, nodeId);
      let agentId: string | undefined;
      if (step.ai) {
        const agent = createAgent(s, p, { nodeId, ...step.ai });
        agentId = String(agent.id);
        createSession(s, p, { agentId, title: `${d.name} · ${step.name}讨论` });
      }
      const item = createItem(s, p, {
        nodeId,
        agentId,
        title: `${d.name} · ${step.name}`,
        objective: step.objective,
        acceptance: "按本节点目标交付，审核通过后登记实际成果。",
        dependencies: step.dependencies.map((key) => items.get(key)!),
      });
      items.set(step.key, String(item.id));
    }
    audit(s, p, "workflow.unit_added", String(section.id), {
      name: d.name,
      nodes: [...nodes.values()],
    });
    return { section, nodes: [...nodes.values()] };
  });
}
