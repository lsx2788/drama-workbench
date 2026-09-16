import type { Store, Row } from "./db";
import { projectExists } from "./common";
import { searchAssets } from "./asset-service";
import { overview } from "./project-service";
import { listStories } from "./story-service";
import { listPreparationRecords } from "./preparation-service";
import { groupEnvelope, groupCandidates } from "./group-service";
import { messagePresenter } from "./message-presentation";
import { workflowOutlines } from "./workflow-outline-service";

export function workspace(s: Store, p: string) {
  projectExists(s, p);
  const presentMessage = messagePresenter(s, p);
  const attachments = new Map<string, Row[]>();
  for (const row of s.all(
    "SELECT d.message_id,st.id,st.title,st.original_name,st.project_id FROM (SELECT message_id,story_id,position FROM story_discussions UNION ALL SELECT message_id,story_id,position FROM chat_attachments) d JOIN story_sources st ON st.id=d.story_id WHERE st.project_id=? ORDER BY d.position",
    p,
  )) {
    const key = String(row.message_id);
    const rows = attachments.get(key) ?? [];
    rows.push({
      id: row.id,
      title: row.title,
      original_name: row.original_name,
      download_url: `/api/v1/projects/${p}/stories/${row.id}/download`,
    });
    attachments.set(key, rows);
  }
  return {
    workflowOutlines: workflowOutlines(s, p),
    groupCandidates: s
      .all(
        "SELECT ss.id FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? AND n.node_type='coordinator'",
        p,
      )
      .flatMap((ss) =>
        groupCandidates(s, p, String(ss.id)).map((member) => ({
          ...member,
          group_id: ss.id,
        })),
      ),
    preparation:
      s.one("SELECT * FROM preparation_setups WHERE project_id=?", p) ?? null,
    preparationRecords: listPreparationRecords(s, p),
    aiRelations: s.all(
      "SELECT r.* FROM ai_relations r JOIN agents a ON a.id=r.child_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?",
      p,
    ),
    overview: overview(s, p),
    stories: listStories(s, p),
    documents: s.all(
      "SELECT * FROM documents WHERE project_id=? ORDER BY created_at DESC",
      p,
    ),
    workflows: s.all(
      "SELECT * FROM workflows WHERE project_id=? ORDER BY created_at DESC",
      p,
    ),
    sections: s.all(
      "SELECT g.*,m.season_id,CASE WHEN e.serial IS NOT NULL THEN printf('E%04d',e.serial) END AS code,e.summary AS episode_summary FROM workflow_sections g JOIN workflows w ON w.id=g.workflow_id LEFT JOIN section_seasons m ON m.section_id=g.id LEFT JOIN episode_entries e ON e.section_id=g.id WHERE w.project_id=? ORDER BY g.position",
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
    messages: s
      .all(
        "SELECT m.*,a.name AS agent_name,sender.name AS sender_name,a.node_id,pv.version AS prompt_version FROM messages m LEFT JOIN agents sender ON sender.id=m.sender_id AND m.sender_type='agent' LEFT JOIN message_prompt_versions pv ON pv.message_id=m.id JOIN sessions ss ON ss.id=m.session_id JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=? ORDER BY m.rowid",
        p,
      )
      .map((message): Row & { attachments: Row[] } => {
        const sources = attachments.get(String(message.id)) ?? [];
        return {
          ...message,
          display_content: presentMessage(message),
          group: groupEnvelope(s, String(message.id)),
          images: s
            .all(
              "SELECT f.id,f.original_name,f.mime,f.version_id FROM ai_images i JOIN files f ON f.id=i.file_id WHERE i.message_id=?",
              String(message.id),
            )
            .map((f) => ({ ...f, url: `/api/v1/projects/${p}/files/${f.id}` })),
          attachments: sources,
          story_id: sources[0]?.id ?? null,
          story_title: sources[0]?.title ?? null,
          story_download_url: sources[0]?.download_url ?? null,
        };
      }),
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
