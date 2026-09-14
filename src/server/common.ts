import { randomUUID } from "node:crypto";
import type { Store, Row } from "./db";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function requireRow(row: Row | undefined, label = "记录"): Row {
  if (!row) throw new DomainError("NOT_FOUND", `${label}不存在`, 404);
  return row;
}
export function projectExists(s: Store, projectId: string) {
  return requireRow(
    s.one("SELECT * FROM projects WHERE id=?", projectId),
    "项目",
  );
}
export function nodeInProject(s: Store, projectId: string, nodeId: string) {
  return requireRow(
    s.one(
      "SELECT n.* FROM nodes n JOIN workflows w ON w.id=n.workflow_id WHERE n.id=? AND w.project_id=?",
      nodeId,
      projectId,
    ),
    "项目节点",
  );
}
export function audit(
  s: Store,
  projectId: string,
  action: string,
  target: string,
  detail: unknown = {},
) {
  s.run(
    "INSERT INTO audit_events VALUES(?,?,?,?,?,?)",
    id(),
    projectId,
    action,
    target,
    JSON.stringify(detail),
    now(),
  );
}
export function assert(
  condition: unknown,
  message: string,
  code = "CONFLICT",
): asserts condition {
  if (!condition) throw new DomainError(code, message, 409);
}
