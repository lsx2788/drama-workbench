import { str, type Workspace, type RecordData } from "./api";
export interface StoryRecord {
  id: string;
  code: string;
  name: string;
  category: string;
  status: string;
  description: string;
  content: string;
  node: string;
  source: RecordData;
  type:
    | "story"
    | "asset"
    | "document"
    | "highlight"
    | "session"
    | "item"
    | "run"
    | "project";
}
export function storyRecords(w: Workspace): StoryRecord[] {
  const nodeName = (id: unknown) => {
    const node = w.nodes.find((n) => n.id === id);
    const section = w.sections.find((s) => s.id === node?.section_id);
    return `${section?.phase === "unit" ? `${str(section, "name")} / ` : ""}${str(node ?? {}, "name")}`;
  };
  const base = (r: RecordData) => ({
    id: str(r, "id"),
    code: str(r, "id").slice(0, 8),
    source: r,
    node: "",
    content: "",
    description: "",
    status: "",
  });
  return [
    ...w.stories.map((r) => ({
      ...base(r),
      type: "story" as const,
      name: str(r, "title"),
      category: "故事文稿",
      description: `原始故事 · ${r.source_kind === "text" ? "粘贴文本" : "上传文件"} · ${str(r, "original_name")}`,
    })),
    {
      ...base(w.overview.project),
      type: "project",
      name: "项目说明与制作目标",
      category: "故事文稿",
      content: str(w.overview.project, "goal"),
      description: str(w.overview.project, "description"),
    },
    ...w.documents.map((r) => ({
      ...base(r),
      type: "document" as const,
      name: str(r, "title"),
      category: "故事文稿",
      status: `修订 ${r.revision}`,
      content: str(r, "content"),
      description: str(r, "content").slice(0, 120),
    })),
    ...w.assets.map((r) => {
      const attrs = JSON.parse(str(r, "attributes_json") || "{}");
      return {
        ...base(r),
        type: "asset" as const,
        code: str(r, "code"),
        name: str(r, "name"),
        category:
          (
            {
              character: "人物",
              scene: "场景",
              prop: "道具与服装",
              costume: "道具与服装",
              composite: "组合资产",
              document: "制作资料",
              image: "图片",
              audio: "音频",
              video: "视频",
            } as Record<string, string>
          )[str(r, "kind")] ?? "制作资料",
        status: r.approved_version ? "approved" : "candidate",
        description: str(r, "description"),
        node: nodeName(attrs.nodeId),
      };
    }),
    ...w.highlights.map((r) => ({
      ...base(r),
      type: "highlight" as const,
      name: str(r, "content"),
      category: "讨论与决策",
      status: str(r, "status"),
      content: str(r, "content"),
      description: str(r, "rationale"),
      node: nodeName(r.node_id),
    })),
    ...w.sessions.map((r) => ({
      ...base(r),
      type: "session" as const,
      name: str(r, "title"),
      category: "讨论与决策",
      status: str(r, "status"),
      description: str(r, "agent_name"),
      node: nodeName(r.node_id),
    })),
    ...w.items.map((r) => ({
      ...base(r),
      type: "item" as const,
      name: str(r, "title"),
      category: "任务与执行",
      status: str(r, "status"),
      content: str(r, "objective"),
      description: str(r, "acceptance"),
      node: nodeName(r.node_id),
    })),
    ...w.runs.map((r) => ({
      ...base(r),
      type: "run" as const,
      name: `执行记录 ${str(r, "id").slice(0, 8)}`,
      category: "任务与执行",
      status: str(r, "status"),
      description: str(r, "error"),
      content: str(r, "input_snapshot"),
    })),
  ] as StoryRecord[];
}
