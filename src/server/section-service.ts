import { z } from "zod";
import type { Store, Row } from "./db";
import { assert, audit, id, now, requireRow } from "./common";
import { createNode } from "./project-service";
import { createAgent, createSession } from "./collaboration-service";
import { createItem } from "./work-service";
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
  return {
    ...requireRow(s.one("SELECT * FROM workflow_sections WHERE id=?", key)),
    season_id: d.seasonId ?? null,
  };
}
export function createSection(s: Store, p: string, input: unknown) {
  const d = sectionSchema.parse(input);
  assert(
    workflow(s, p, d.workflowId).status === "draft",
    "分组结构在流程草案中定义，已发布流程请使用分集扩展接口",
  );
  return s.transaction(() => insertSection(s, d));
}
const unitSchema = z
  .object({
    workflowId: z.string().uuid(),
    name: short,
    kind: z.enum(["episode", "chapter"]),
    seasonId: z.string().uuid().optional(),
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
      .min(1)
      .max(50),
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
    const grouped = s.all(
      "SELECT n.*,g.phase,g.id AS section_id FROM nodes n JOIN node_sections m ON m.node_id=n.id JOIN workflow_sections g ON g.id=m.section_id WHERE n.workflow_id=?",
      d.workflowId,
    );
    const prep = grouped.filter(
      (n) => n.phase === "preparation" && n.node_type !== "coordinator",
    );
    const delivery = grouped.filter((n) => n.phase === "delivery");
    assert(
      prep.length && delivery.length,
      "先定义全剧前期与汇总节点，再扩展分集",
    );
    assert(
      delivery.every((n) => n.status === "planned"),
      "全剧汇总已开始，请先处理汇总状态再扩展分集",
    );
    for (const n of delivery)
      assert(
        !s.one(
          "SELECT id FROM items WHERE node_id=? AND status NOT IN ('planned','cancelled')",
          String(n.id),
        ),
        "汇总事项已开始，不能插入新的分集前置依赖",
      );
    const edges = s.all(
      "SELECT e.* FROM node_dependencies e JOIN nodes n ON n.id=e.node_id WHERE n.workflow_id=?",
      d.workflowId,
    );
    const order: Record<string, number> = {
      preparation: 0,
      unit: 1,
      delivery: 2,
    };
    for (const e of edges) {
      const source = grouped.find((n) => n.id === e.depends_on),
        target = grouped.find((n) => n.id === e.node_id);
      if (source && target)
        assert(
          order[String(source.phase)] <= order[String(target.phase)],
          "流程分组包含反向依赖，请先整理分组",
        );
    }
    const prepEnds = prep.filter(
      (n) =>
        !edges.some(
          (e) =>
            e.depends_on === n.id &&
            prep.some((other) => other.id === e.node_id),
        ),
    );
    const deliveryStarts = delivery.filter(
      (n) =>
        !edges.some(
          (e) =>
            e.node_id === n.id &&
            delivery.some((other) => other.id === e.depends_on),
        ),
    );
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
        : prepEnds.map((n) => String(n.id));
      const node = createNode(
        s,
        p,
        {
          workflowId: d.workflowId,
          sectionId: section.id,
          name: step.name,
          objective: step.objective,
          dependencies: parents,
        },
        { appendUnit: true },
      )!;
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
    const exits = d.steps
      .filter(
        (step) =>
          !d.steps.some((other) => other.dependencies.includes(step.key)),
      )
      .map((step) => nodes.get(step.key)!);
    for (const target of deliveryStarts)
      for (const source of exits)
        s.run(
          "INSERT INTO node_dependencies VALUES(?,?)",
          String(target.id),
          source,
        );
    audit(s, p, "workflow.unit_added", String(section.id), {
      name: d.name,
      nodes: [...nodes.values()],
    });
    return { section, nodes: [...nodes.values()] };
  });
}
