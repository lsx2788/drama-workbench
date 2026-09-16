import type { Store } from "./db";
import {
  assertDeliveryReady,
  assertProductionCanExpand,
  syncDeliveryGates,
} from "./workflow-structure";
import {
  id,
  now,
  requireRow,
  projectExists,
  nodeInProject,
  assert,
  audit,
} from "./common";
import {
  documentSchema,
  workflowSchema,
  nodeSchema,
  projectSchema,
} from "./schemas";

export function createProject(s: Store, input: unknown) {
  const p = projectSchema.parse(input),
    projectId = id();
  s.run(
    "INSERT INTO projects VALUES(?,?,?,?,?)",
    projectId,
    p.name,
    p.description,
    p.goal,
    now(),
  );
  return projectExists(s, projectId);
}
export function listProjects(s: Store, archived = false) {
  return s.all(
    `SELECT p.* FROM projects p WHERE NOT EXISTS(SELECT 1 FROM project_trash t WHERE t.project_id=p.id) AND ${archived ? "" : "NOT "}EXISTS(SELECT 1 FROM project_archives a WHERE a.project_id=p.id) ORDER BY p.created_at DESC`,
  );
}
export function archiveProject(s: Store, p: string, archived: boolean) {
  projectExists(s, p);
  return s.transaction(() => {
    if (archived)
      s.run("INSERT OR IGNORE INTO project_archives VALUES(?,?)", p, now());
    else s.run("DELETE FROM project_archives WHERE project_id=?", p);
    audit(s, p, archived ? "project.archived" : "project.restored", p);
    return { projectId: p, archived };
  });
}
export function createDocument(s: Store, p: string, input: unknown) {
  projectExists(s, p);
  const d = documentSchema.parse(input);
  let revision = 1;
  return s.transaction(() => {
    if (d.supersedesId) {
      const previous = requireRow(
        s.one(
          "SELECT * FROM documents WHERE id=? AND project_id=?",
          d.supersedesId,
          p,
        ),
        "文稿",
      );
      assert(
        !s.one(
          "SELECT id FROM documents WHERE supersedes_id=?",
          d.supersedesId,
        ),
        "该文稿已有后续修订，请刷新",
      );
      revision = Number(previous.revision) + 1;
    }
    const key = id();
    s.run(
      "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)",
      key,
      p,
      d.title,
      d.kind,
      d.content,
      revision,
      d.supersedesId ?? null,
      now(),
    );
    return s.one("SELECT * FROM documents WHERE id=?", key);
  });
}
export function createWorkflow(s: Store, p: string, input: unknown) {
  projectExists(s, p);
  const d = workflowSchema.parse(input),
    key = id();
  s.run(
    "INSERT INTO workflows VALUES(?,?,?,?,?)",
    key,
    p,
    d.name,
    "draft",
    now(),
  );
  return s.one("SELECT * FROM workflows WHERE id=?", key);
}
export function createNode(s: Store, p: string, input: unknown) {
  const d = nodeSchema.parse(input);
  const w = requireRow(
    s.one(
      "SELECT * FROM workflows WHERE id=? AND project_id=?",
      d.workflowId,
      p,
    ),
    "流程",
  );
  assert(w.status === "draft" || w.status === "active", "归档流程不能增加节点");
  if (d.sectionId)
    assert(
      s.one(
        "SELECT id FROM workflow_sections WHERE id=? AND workflow_id=?",
        d.sectionId,
        d.workflowId,
      ),
      "节点分组必须属于同一流程",
    );
  for (const parent of d.dependencies)
    assert(
      nodeInProject(s, p, parent).workflow_id === d.workflowId,
      "依赖节点必须属于同一流程",
    );
  return s.transaction(() => {
    const section = d.sectionId
      ? s.one("SELECT * FROM workflow_sections WHERE id=?", d.sectionId)
      : undefined;
    if (d.nodeType === "coordinator")
      assert(
        !section || section.phase === "preparation",
        "总控应属于共用前期或不分组",
      );
    else if (section?.phase !== "delivery")
      assertProductionCanExpand(s, d.workflowId);
    const key = id(),
      count = Number(
        s.one(
          "SELECT COUNT(*) AS count FROM nodes WHERE workflow_id=?",
          d.workflowId,
        )?.count,
      );
    s.run(
      "INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?)",
      key,
      d.workflowId,
      d.name,
      d.objective,
      d.nodeType,
      "planned",
      count,
      now(),
    );
    for (const parent of new Set(d.dependencies))
      s.run("INSERT INTO node_dependencies VALUES(?,?)", key, parent);
    if (d.sectionId)
      s.run("INSERT INTO node_sections VALUES(?,?)", key, d.sectionId);
    syncDeliveryGates(s, p, d.workflowId);
    audit(s, p, "workflow.node_added", key, {
      workflowId: d.workflowId,
      sectionId: d.sectionId ?? null,
      dependencies: d.dependencies,
    });
    return s.one("SELECT * FROM nodes WHERE id=?", key);
  });
}
export function activateWorkflow(s: Store, p: string, key: string) {
  return s.transaction(() => {
    const w = requireRow(
      s.one("SELECT * FROM workflows WHERE id=? AND project_id=?", key, p),
      "流程",
    );
    assert(w.status === "draft", "只能发布流程草案");
    assert(
      s.one("SELECT id FROM nodes WHERE workflow_id=?", key),
      "空流程不能发布",
    );
    assert(
      !s.one(
        "SELECT n.id FROM nodes n JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND w.status='active' AND n.status IN ('active','blocked','review')",
        p,
      ),
      "当前流程有进行中的节点，先处理再替换",
    );
    assert(
      !s.one(
        "SELECT i.id FROM items i JOIN nodes n ON n.id=i.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND w.status='active' AND i.status NOT IN ('completed','cancelled')",
        p,
      ),
      "当前流程还有未完成事项，先处理再替换",
    );
    s.run(
      "UPDATE workflows SET status='archived' WHERE project_id=? AND status='active'",
      p,
    );
    s.run("UPDATE workflows SET status='active' WHERE id=?", key);
    audit(s, p, "workflow.published", key);
    return s.one("SELECT * FROM workflows WHERE id=?", key);
  });
}
export function updateNodeState(
  s: Store,
  p: string,
  key: string,
  status: string,
) {
  const n = nodeInProject(s, p, key);
  const w = requireRow(
    s.one("SELECT * FROM workflows WHERE id=?", String(n.workflow_id)),
  );
  assert(w.status === "active", "只有当前已发布流程的节点可以推进");
  if (["active", "review", "completed"].includes(status)) {
    assertDeliveryReady(s, key);
    assert(
      !s.one(
        "SELECT d.depends_on FROM node_dependencies d JOIN nodes n ON n.id=d.depends_on WHERE d.node_id=? AND n.status<>'completed'",
        key,
      ),
      "前置节点尚未完成",
    );
  }
  if (status === "completed")
    assert(
      !s.one(
        "SELECT id FROM items WHERE node_id=? AND status NOT IN ('completed','cancelled')",
        key,
      ),
      "节点中还有未完成事项",
    );
  if (status !== "completed" && n.status === "completed")
    assert(
      !s.one(
        "SELECT n.id FROM node_dependencies d JOIN nodes n ON n.id=d.node_id WHERE d.depends_on=? AND n.status IN ('active','review','completed')",
        key,
      ),
      "下游已开始，请先处理下游状态",
    );
  s.run("UPDATE nodes SET status=? WHERE id=?", status, key);
  audit(s, p, "node.state", key, { status });
  return nodeInProject(s, p, key);
}
export function overview(s: Store, p: string) {
  const project = projectExists(s, p);
  return {
    project,
    workflow:
      s.one(
        "SELECT * FROM workflows WHERE project_id=? AND status='active'",
        p,
      ) ?? null,
    stages: s.all(
      "SELECT n.* FROM nodes n JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND w.status='active' ORDER BY n.position",
      p,
    ),
    counts: {
      assets: Number(
        s.one("SELECT COUNT(*) AS n FROM assets WHERE project_id=?", p)?.n,
      ),
      approved: Number(
        s.one(
          "SELECT COUNT(*) AS n FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=? AND v.status='approved'",
          p,
        )?.n,
      ),
      items: Number(
        s.one(
          "SELECT COUNT(*) AS n FROM items i JOIN nodes n ON n.id=i.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?",
          p,
        )?.n,
      ),
    },
    blockers: s.all(
      "SELECT i.* FROM items i JOIN nodes n ON n.id=i.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND i.status='blocked'",
      p,
    ),
    pendingReviews: s.all(
      "SELECT v.*,a.name,a.code FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=? AND v.status='candidate'",
      p,
    ),
  };
}
