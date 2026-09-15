import type { Store } from "./db";
import { projectExists } from "./common";
import { searchAssets } from "./asset-service";
import { overview } from "./project-service";

export function workspace(s: Store, p: string) {
  projectExists(s, p);
  return {
    overview: overview(s, p),
    documents: s.all(
      "SELECT * FROM documents WHERE project_id=? ORDER BY created_at DESC",
      p,
    ),
    workflows: s.all(
      "SELECT * FROM workflows WHERE project_id=? ORDER BY created_at DESC",
      p,
    ),
    sections: s.all(
      "SELECT g.*,m.season_id FROM workflow_sections g JOIN workflows w ON w.id=g.workflow_id LEFT JOIN section_seasons m ON m.section_id=g.id WHERE w.project_id=? ORDER BY g.position",
      p,
    ),
    seasons: s.all(
      "SELECT g.* FROM workflow_seasons g JOIN workflows w ON w.id=g.workflow_id WHERE w.project_id=? ORDER BY g.position",
      p,
    ),
    nodes: s.all(
      "SELECT n.*,g.section_id FROM nodes n JOIN workflows w ON w.id=n.workflow_id LEFT JOIN node_sections g ON g.node_id=n.id WHERE w.project_id=? ORDER BY n.position",
      p,
    ),
    dependencies: s.all(
      "SELECT d.* FROM node_dependencies d JOIN nodes n ON n.id=d.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?",
      p,
    ),
    agents: s.all(
      "SELECT a.*,n.node_type FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?",
      p,
    ),
    sessions: s.all(
      "SELECT ss.*,a.name AS agent_name,a.node_id,n.node_type FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? ORDER BY ss.created_at",
      p,
    ),
    messages: s.all(
      "SELECT m.*,a.name AS agent_name,a.node_id FROM messages m JOIN sessions ss ON ss.id=m.session_id JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? ORDER BY m.created_at",
      p,
    ),
    highlights: s.all(
      "SELECT h.* FROM highlights h JOIN nodes n ON n.id=h.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? ORDER BY h.created_at DESC",
      p,
    ),
    items: s.all(
      "SELECT i.* FROM items i JOIN nodes n ON n.id=i.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? ORDER BY i.created_at DESC",
      p,
    ),
    assets: searchAssets(s, p),
    approvedVersions: s.all(
      "SELECT v.id,v.version,a.id AS asset_id,a.code,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=? AND v.status='approved' ORDER BY a.code,v.version DESC",
      p,
    ),
    runs: s.all(
      "SELECT r.* FROM runs r JOIN items i ON i.id=r.item_id JOIN nodes n ON n.id=i.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? ORDER BY r.created_at DESC",
      p,
    ),
    skills: s.all("SELECT * FROM skills ORDER BY name"),
    audit: s.all(
      "SELECT * FROM audit_events WHERE project_id=? ORDER BY created_at DESC LIMIT 30",
      p,
    ),
  };
}
