import { str, type RecordData, type Workspace } from "./api";

export type FlowTarget = {
  kind: "node" | "unit" | "season" | "knowledge";
  id: string;
};
export function unitProgress(nodes: RecordData[]) {
  const completed = nodes.filter((n) => n.status === "completed").length;
  const status = !nodes.length
    ? "planned"
    : completed === nodes.length
      ? "completed"
      : nodes.some((n) => n.status === "blocked")
        ? "blocked"
        : nodes.some((n) => n.status !== "planned")
          ? "active"
          : "planned";
  return { completed, total: nodes.length, status };
}

/** Read-only overview projection. Membership arrows are not execution gates. */
export function productionMap(
  w: Pick<
    Workspace,
    "nodes" | "sections" | "seasons" | "dependencies" | "preparation"
  >,
  workflowId: string,
) {
  const sourceNodes = w.nodes.filter((n) => n.workflow_id === workflowId);
  const units = w.sections.filter(
    (s) => s.workflow_id === workflowId && s.phase === "unit",
  );
  const seasons = (w.seasons ?? []).filter((s) => s.workflow_id === workflowId);
  const unitById = new Map(units.map((s) => [str(s, "id"), s]));
  const unitNodes = (unitId: string) =>
    sourceNodes.filter((n) => n.section_id === unitId);
  const targets = new Map<string, FlowTarget>();
  const project = new Map<string, string>();
  const nodes: RecordData[] = [];
  for (const n of sourceNodes) {
    const key = str(n, "id"),
      unit = unitById.get(str(n, "section_id"));
    project.set(key, unit ? `unit:${unit.id}` : key);
    if (unit) continue;
    targets.set(key, { kind: "node", id: key });
    nodes.push({
      ...n,
      summary:
        n.node_type === "coordinator"
          ? "项目基本信息 · 故事大纲 · 总控讨论"
          : n.objective,
      graph_kind: n.node_type === "coordinator" ? "coordinator" : "node",
    });
  }
  for (const season of seasons) {
    const seasonId = str(season, "id"),
      key = `season:${seasonId}`;
    const children = units.filter((s) => s.season_id === seasonId);
    const progress = unitProgress(
      children.flatMap((s) => unitNodes(str(s, "id"))),
    );
    targets.set(key, { kind: "season", id: seasonId });
    nodes.push({
      id: key,
      name: season.name,
      status: progress.status,
      graph_kind: "season",
      summary: children.length
        ? `${children.length} 个分集 / 章节 · 查看本季内容`
        : "尚未定义分集，可随故事推进扩展",
    });
  }
  for (const unit of units) {
    const unitId = str(unit, "id"),
      key = `unit:${unitId}`;
    const progress = unitProgress(unitNodes(unitId));
    targets.set(key, { kind: "unit", id: unitId });
    nodes.push({
      id: key,
      name: unit.code ? `${unit.code} · ${unit.name}` : unit.name,
      status: progress.status,
      graph_kind: "unit",
      summary: progress.total
        ? `${progress.completed} / ${progress.total} 个步骤完成 · 点击进入具体制作流程`
        : "制作步骤尚未定义 · 讨论确定后逐步补充",
    });
  }
  const edges = new Map<string, RecordData>();
  const link = (from: string, to: string, relation = "dependency") => {
    if (from !== to && targets.has(from) && targets.has(to))
      edges.set(`${from}:${to}`, { depends_on: from, node_id: to, relation });
  };
  for (const edge of w.dependencies) {
    const from = project.get(str(edge, "depends_on")),
      to = project.get(str(edge, "node_id"));
    if (!from || !to || from === to) continue;
    const unit = units.find((s) => `unit:${s.id}` === to);
    const seasonKey = unit?.season_id ? `season:${unit.season_id}` : "";
    // Shared prerequisites lead into the season; cross-unit dependencies stay explicit.
    if (
      seasonKey &&
      targets.has(seasonKey) &&
      targets.get(from)?.kind === "node"
    )
      link(from, seasonKey);
    else link(from, to);
  }
  for (const unit of units) {
    if (unit.season_id)
      link(`season:${unit.season_id}`, `unit:${unit.id}`, "membership");
  }
  // A planned empty season is visible without inventing an archive gate.
  const prepIds = new Set(
    w.sections
      .filter((s) => s.workflow_id === workflowId && s.phase === "preparation")
      .map((s) => s.id),
  );
  const prep = sourceNodes.filter(
    (n) => prepIds.has(n.section_id) && n.node_type !== "coordinator",
  );
  const prepEnds = prep.filter(
    (n) =>
      !w.dependencies.some(
        (e) =>
          e.depends_on === n.id && prep.some((other) => other.id === e.node_id),
      ),
  );
  for (const unit of units.filter(
    (s) => !s.season_id && !unitNodes(str(s, "id")).length,
  )) {
    for (const n of prepEnds)
      link(str(n, "id"), `unit:${unit.id}`, "membership");
  }
  for (const season of seasons) {
    const key = `season:${season.id}`;
    if (![...edges.values()].some((e) => e.node_id === key)) {
      for (const n of prepEnds) link(str(n, "id"), key, "membership");
    }
  }
  const coordinator = sourceNodes.find((n) => n.node_type === "coordinator");
  if (coordinator && w.preparation?.workflow_id === workflowId) {
    const key = `knowledge:${workflowId}`;
    targets.set(key, { kind: "knowledge", id: workflowId });
    nodes.push({
      id: key,
      name: "故事资料",
      summary: "原作概况 · 人物与知识关系 · 公共资产引用",
      status: "reference",
      graph_kind: "knowledge",
    });
    link(str(coordinator, "id"), key, "navigation");
  }
  if (
    coordinator &&
    ![...edges.values()].some((e) => e.node_id === coordinator.id)
  ) {
    const roots = nodes.filter(
      (n) =>
        n.id !== coordinator.id &&
        ![...edges.values()].some((e) => e.node_id === n.id),
    );
    for (const root of roots)
      link(str(coordinator, "id"), str(root, "id"), "navigation");
  }
  return { nodes, dependencies: [...edges.values()], targets };
}
