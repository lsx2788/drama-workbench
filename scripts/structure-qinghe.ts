import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Store } from "../src/server/db";
import { assert, audit, id, now, requireRow } from "../src/server/common";
import { appendUnit } from "../src/server/section-service";
import { createDocument } from "../src/server/project-service";
import { stages } from "./demo-data";

/** Upgrade only the known, unstarted Qinghe fixture; preserve all node/session/asset IDs. */
export function structureQinghe(s: Store, p: string) {
  if (
    s.one(
      "SELECT id FROM audit_events WHERE project_id=? AND action='qinghe.structured'",
      p,
    )
  )
    return;
  const workflow = requireRow(
    s.one("SELECT * FROM workflows WHERE project_id=? AND status='active'", p),
  );
  const workflowId = String(workflow.id);
  const nodes = s.all("SELECT * FROM nodes WHERE workflow_id=?", workflowId);
  assert(
    nodes.length === stages.length &&
      nodes.every((n) => n.status === "planned"),
    "只迁移尚未开始的原始青禾剑录流程",
  );
  const mapping = new Map(
    stages.map((stage) => [
      stage.key as string,
      String(
        requireRow(
          nodes.find((n) => n.name === stage.name),
          stage.name,
        ).id,
      ),
    ]),
  );
  const allItems = s.all(
    "SELECT i.* FROM items i JOIN nodes n ON n.id=i.node_id WHERE n.workflow_id=?",
    workflowId,
  );
  assert(
    allItems.every((i) => i.status === "planned"),
    "已有事项开始执行，不能重排前置依赖",
  );
  assert(
    !s.one("SELECT id FROM workflow_sections WHERE workflow_id=?", workflowId),
    "流程已经分组，请保留现有分组",
  );
  const before = ["control", "story", "characters", "world", "base"];
  const parents: Record<string, string[]> = {
    control: [],
    story: [],
    characters: ["story"],
    world: ["story"],
    base: ["characters", "world"],
    script: ["base"],
    breakdown: ["script"],
    needs: ["breakdown"],
    composite: ["needs"],
    storyboard: ["composite"],
    stills: ["storyboard"],
    audio: ["storyboard"],
    video: ["stills", "audio"],
    edit: ["video", "audio"],
    review: ["edit"],
    archive: ["review"],
  };
  const unitStages = stages.filter(
    (stage) => !before.includes(stage.key) && stage.key !== "archive",
  );
  s.transaction(() => {
    const prep = id(),
      first = id(),
      delivery = id();
    for (const [key, phase, kind, name] of [
      [prep, "preparation", "shared", "全剧大纲与基础资产"],
      [first, "unit", "episode", "第 1 集 · 渡口藏账"],
      [delivery, "delivery", "shared", "全剧审核与归档"],
    ])
      s.run(
        "INSERT INTO workflow_sections VALUES(?,?,?,?,?,?,?)",
        key,
        workflowId,
        phase,
        kind,
        name,
        0,
        now(),
      );
    for (const stage of stages)
      s.run(
        "INSERT INTO node_sections VALUES(?,?)",
        mapping.get(stage.key)!,
        before.includes(stage.key)
          ? prep
          : stage.key === "archive"
            ? delivery
            : first,
      );
    s.run(
      "DELETE FROM node_dependencies WHERE node_id IN (SELECT id FROM nodes WHERE workflow_id=?)",
      workflowId,
    );
    s.run(
      "DELETE FROM item_dependencies WHERE item_id IN (SELECT i.id FROM items i JOIN nodes n ON n.id=i.node_id WHERE n.workflow_id=?)",
      workflowId,
    );
    for (const [key, dependencies] of Object.entries(parents))
      for (const parent of dependencies) {
        s.run(
          "INSERT INTO node_dependencies VALUES(?,?)",
          mapping.get(key)!,
          mapping.get(parent)!,
        );
        for (const target of allItems.filter(
          (i) => i.node_id === mapping.get(key),
        ))
          for (const source of allItems.filter(
            (i) => i.node_id === mapping.get(parent),
          ))
            s.run(
              "INSERT INTO item_dependencies VALUES(?,?)",
              String(target.id),
              String(source.id),
            );
      }
    s.run(
      "UPDATE nodes SET objective=? WHERE id=?",
      "根据全剧故事大纲梳理共用人物及青年/中年形态、服装规范。分集出现的新形态或修改需求，由对应分集反馈总控后补充。",
      mapping.get("characters")!,
    );
    s.run(
      "UPDATE nodes SET objective=? WHERE id=?",
      "根据全剧大纲规划古渡、县衙档案室、谷仓与青禾剑等共用资产。每集按具体场景分析复用与补制需求。",
      mapping.get("world")!,
    );
    s.run(
      "UPDATE nodes SET name=?,objective=? WHERE id=?",
      "全剧审核与归档",
      "输入：各集已审核成片、工程与资产引用。\n交付：全剧连续性审核、发布母版及项目归档。\n所有制作单元完成后再汇总；组合资产保留供后续复用。",
      mapping.get("archive")!,
    );
    for (const [number, title, plot] of [
      [
        2,
        "两本账",
        "沈砚与江绾进入县衙档案室，对照官账和渡口运单；上司焚毁官账，江绾记下北山谷仓位置。结尾沈砚发现父亲的签字。",
      ],
      [
        3,
        "开仓",
        "两人在北山谷仓对峙，剑鞘中的收据证明父亲是在追查真相；公开证据、开仓救济。回到二十年后的沈砚，收剑结束叙述。",
      ],
    ] as const) {
      appendUnit(s, p, {
        workflowId,
        name: `第 ${number} 集 · ${title}`,
        kind: "episode",
        steps: unitStages.map((stage) => ({
          key: stage.key,
          name: stage.name,
          objective: `第 ${number} 集《${title}》\n本集情节：${plot}\n输入：${stage.input}\n交付：${stage.output}\n审核：${stage.review}`,
          dependencies: parents[stage.key].filter((key) =>
            unitStages.some((other) => other.key === key),
          ),
          ai: {
            name: `第 ${number} 集 · ${stage.name} AI`,
            purpose: stage.output,
            instructions: `仅负责第 ${number} 集《${title}》的${stage.name}。共用已批准的全剧资产版本，缺项和冲突向总控反馈；产物和结论绑定本集节点。`,
          },
        })),
      });
      createDocument(s, p, {
        title: `第 ${number} 集 · ${title} · 剧情规划`,
        kind: "outline",
        content: `第 ${number} 集《${title}》，目标约 90 秒。\n${plot}\n逐场剧本、分镜和素材由本集对应节点逐步完成。`,
      });
    }
    audit(s, p, "qinghe.structured", workflowId, {
      units: 3,
      preservedOriginalNodes: true,
    });
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const s = new Store(process.env.DATA_DIR || "./data");
  try {
    const project = requireRow(
      s.one(
        "SELECT project_id FROM audit_events WHERE action='demo.seeded' AND target_id='qinghe-v1'",
      ),
    );
    mkdirSync(path.join(s.root, "backups"), { recursive: true });
    s.run(
      "VACUUM INTO ?",
      path.join(s.root, "backups", `before-episodic-flow-${Date.now()}.sqlite`),
    );
    structureQinghe(s, String(project.project_id));
    console.log("青禾剑录已整理为全剧规划、三集制作、全剧汇总。");
  } finally {
    s.close();
  }
}
