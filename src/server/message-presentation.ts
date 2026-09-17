import type { Store, Row } from "./db";
import { projectExists } from "./common";

const uuid =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const readable = (value: unknown) =>
  String(value).replace(/[\\`*_[\]<>]/g, "\\$&");

/** Display projection only. Runtime, references and audits keep exact original text. */
export function messagePresenter(s: Store, p: string) {
  const names = new Map<string, string>([
    [p, `《${readable(projectExists(s, p).name)}》`],
  ]);
  for (const row of s.all(
    `
    SELECT a.id,a.name FROM agents a JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?
    UNION ALL SELECT ss.id,a.name FROM sessions ss JOIN agents a ON a.id=ss.agent_id JOIN nodes n ON n.id=a.node_id JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?
    UNION ALL SELECT n.id,n.name FROM nodes n JOIN workflows w ON w.id=n.workflow_id WHERE w.project_id=?
    UNION ALL SELECT id,original_name AS name FROM story_sources WHERE project_id=?
    UNION ALL SELECT id,json_extract(content_json,'$.title') AS name FROM preparation_records WHERE project_id=?
    UNION ALL SELECT id,name FROM assets WHERE project_id=?
    UNION ALL SELECT v.id,a.name||'（第'||v.version||'版）' FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=?
    UNION ALL SELECT g.id,g.name FROM workflow_sections g JOIN workflows w ON w.id=g.workflow_id WHERE w.project_id=?
  `,
    p,
    p,
    p,
    p,
    p,
    p,
    p,
    p,
  ))
    names.set(String(row.id), readable(row.name ?? "相关记录"));
  const stories = s.all(
    "SELECT id,original_name,sha256 FROM story_sources WHERE project_id=?",
    p,
  );
  const authorizationCodes = s
    .all(
      "SELECT authorization_code FROM child_authorizations WHERE project_id=? AND authorization_code IS NOT NULL",
      p,
    )
    .map((r) => String(r.authorization_code));
  return (message: Row) => {
    let text = String(message.content ?? "");
    if (message.sender_type !== "agent") return text;
    for (const code of authorizationCodes)
      text = text.replaceAll(code, "[授权信息已隐藏]");
    // Checksums are transport metadata, not story details.
    text = text.replace(
      /\bsha[-_ ]?256\s*[:：=]?\s*[a-f0-9]{64}\b[，,;；]?\s*/gi,
      "",
    );
    for (const story of stories) {
      text = text.replaceAll(String(story.sha256), "");
      const url = `/api/v1/projects/${p}/stories/${story.id}/download`;
      text = text.replaceAll(url, `《${readable(story.original_name)}》`);
    }
    text = text.replace(
      uuid,
      (key) => names.get(key.toLowerCase()) ?? "相关记录",
    );
    text = text.replace(
      /\b(?:storyId|sourceId|sessionId|projectId|recordId|fileId|assetVersionId)\s*[:：=]?\s*/g,
      "",
    );
    text = text.replace(
      /\bhasMore\s*[:：=]\s*(true|false)\b/gi,
      (_, value: string) =>
        value.toLowerCase() === "true" ? "还有后续内容" : "已到文末",
    );
    const terms: Record<string, string> = {
      read_document: "分段读取文档",
      read_source_range: "按范围读取原文",
      ask_child: "联系协作 AI",
      save_record: "保存成果",
      review_record: "审核成果",
      group_members: "查看讨论成员",
      group_member: "调整讨论成员",
      create_episodes: "建立剧集入口",
      overview: "故事概况",
      requirements: "制作需求",
      framework: "改编框架",
    };
    text = text.replace(
      /\b(read_document|read_source_range|ask_child|save_record|review_record|group_members|group_member|create_episodes|overview|requirements|framework)\b/g,
      (key) => terms[key],
    );
    return text
      .replace(/[，,]\s*[，,]/g, "，")
      .replace(/[，,]\s*([。；])/g, "$1")
      .trim();
  };
}
