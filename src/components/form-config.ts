import { str, type Workspace } from "@/client/api";
export type FormKind =
  | "story"
  | "project"
  | "workflow"
  | "node"
  | "agent"
  | "session"
  | "document"
  | "asset"
  | "item"
  | "highlight";
export type Option = { value: string; label: string };
type InputField = {
  key: string;
  label: string;
  type?: "area" | "select" | "json" | "multi";
  options?: Option[];
  optional?: boolean;
  initial?: string;
};
export function fields(kind: FormKind, w?: Workspace): InputField[] {
  const nodes =
    w?.nodes.map((r) => ({ value: str(r, "id"), label: str(r, "name") })) ?? [];
  const common = [{ key: "name", label: "名称" }];
  switch (kind) {
    case "story":
      return [];
    case "project":
      return [
        ...common,
        { key: "description", label: "项目说明", type: "area", optional: true },
        { key: "goal", label: "制作目标", type: "area", optional: true },
      ];
    case "workflow":
      return [...common];
    case "node":
      return [
        {
          key: "workflowId",
          label: "所属流程草案",
          type: "select",
          options: w?.workflows
            .filter((r) => r.status === "draft")
            .map((r) => ({ value: str(r, "id"), label: str(r, "name") })),
        },
        ...common,
        {
          key: "nodeType",
          label: "节点类型",
          type: "select",
          options: [
            { value: "work", label: "专业制作节点" },
            { value: "coordinator", label: "总控协调节点" },
          ],
        },
        {
          key: "objective",
          label: "本节点要解决什么",
          type: "area",
          optional: true,
        },
        {
          key: "dependencies",
          label: "前置节点（可多选）",
          type: "multi",
          options: nodes,
          optional: true,
          initial: "[]",
        },
      ];
    case "agent":
      return [
        {
          key: "nodeId",
          label: "所属流程节点",
          type: "select",
          options: nodes,
        },
        ...common,
        { key: "purpose", label: "这个 AI 的定位" },
        {
          key: "instructions",
          label: "提示词与工作要求",
          type: "area",
          optional: true,
        },
        { key: "provider", label: "模型服务", initial: "unconfigured" },
        { key: "model", label: "模型名称", optional: true },
        {
          key: "tools",
          label: "允许使用的能力",
          type: "multi",
          options: [
            { value: "writing", label: "文稿创作" },
            { value: "storyboard", label: "分镜编写" },
            { value: "image_generation", label: "图片生成" },
            { value: "video_generation", label: "视频生成" },
            { value: "asset_query", label: "资产查询" },
          ],
          initial: "[]",
        },
      ];
    case "session":
      return [
        {
          key: "agentId",
          label: "参与 AI",
          type: "select",
          options: w?.agents.map((r) => ({
            value: str(r, "id"),
            label: str(r, "name"),
          })),
        },
        { key: "title", label: "讨论主题" },
        {
          key: "externalSessionId",
          label: "外部 Session / Thread ID（可选）",
          optional: true,
        },
        {
          key: "predecessorId",
          label: "接续哪次讨论（可选）",
          type: "select",
          options: [
            { value: "", label: "开启独立讨论" },
            ...(w?.sessions.map((r) => ({
              value: str(r, "id"),
              label: str(r, "title"),
            })) ?? []),
          ],
          optional: true,
        },
      ];
    case "document":
      return [
        { key: "title", label: "文稿标题" },
        {
          key: "kind",
          label: "文稿类型",
          type: "select",
          options: [
            { value: "outline", label: "故事大纲" },
            { value: "script", label: "剧本" },
            { value: "note", label: "制作笔记" },
          ],
        },
        { key: "content", label: "正文", type: "area" },
        {
          key: "supersedesId",
          label: "修订哪份文稿（可选）",
          type: "select",
          options: [
            { value: "", label: "新文稿" },
            ...(w?.documents.map((r) => ({
              value: str(r, "id"),
              label: str(r, "title") + " · 修订 " + str(r, "revision"),
            })) ?? []),
          ],
          optional: true,
        },
      ];
    case "asset":
      return [
        { key: "code", label: "资产编号，例如 001" },
        { key: "name", label: "资产名称" },
        {
          key: "kind",
          label: "资产类型",
          type: "select",
          options: [
            ["character", "人物"],
            ["costume", "服装"],
            ["prop", "道具"],
            ["scene", "场景"],
            ["composite", "组合"],
            ["document", "文稿"],
            ["image", "图片"],
            ["audio", "音频"],
            ["video", "视频"],
          ].map(([value, label]) => ({ value, label })),
        },
        {
          key: "entityKey",
          label: "角色 / 对象标识，例如 male-lead",
          optional: true,
        },
        {
          key: "description",
          label: "实际内容与适用范围",
          type: "area",
          optional: true,
        },
        {
          key: "attributes",
          label: "可检索属性（JSON）",
          type: "json",
          initial: "{}",
        },
      ];
    case "item":
      return [
        { key: "nodeId", label: "所属节点", type: "select", options: nodes },
        { key: "title", label: "事项名称" },
        {
          key: "objective",
          label: "需要解决什么",
          type: "area",
          optional: true,
        },
        {
          key: "acceptance",
          label: "交付与验收要求",
          type: "area",
          optional: true,
        },
        {
          key: "agentId",
          label: "执行 AI（可选，须属于本节点）",
          type: "select",
          optional: true,
          options: [
            { value: "", label: "稍后配置" },
            ...(w?.agents.map((r) => ({
              value: str(r, "id"),
              label: str(r, "name"),
            })) ?? []),
          ],
        },
        {
          key: "inputs",
          label: "使用哪些定稿版本（可多选）",
          type: "multi",
          options: w?.approvedVersions.map((r) => ({
            value: str(r, "id"),
            label:
              str(r, "code") +
              " · " +
              str(r, "name") +
              " · v" +
              str(r, "version"),
          })),
          initial: "[]",
        },
        {
          key: "dependencies",
          label: "前置事项（可多选）",
          type: "multi",
          options: w?.items.map((r) => ({
            value: str(r, "id"),
            label: str(r, "title"),
          })),
          initial: "[]",
        },
      ];
    case "highlight":
      return [
        { key: "nodeId", label: "所属节点", type: "select", options: nodes },
        {
          key: "kind",
          label: "重点类型",
          type: "select",
          options: [
            ["decision", "关键结论"],
            ["question", "未解决问题"],
            ["goal", "讨论目标"],
            ["next_step", "下一步"],
          ].map(([value, label]) => ({ value, label })),
        },
        { key: "content", label: "核心内容", type: "area" },
        { key: "rationale", label: "理由与取舍", type: "area", optional: true },
        {
          key: "status",
          label: "确认状态",
          type: "select",
          options: [
            { value: "proposed", label: "提议 / 待确认" },
            { value: "confirmed", label: "明确确认" },
          ],
        },
        {
          key: "sourceMessageId",
          label: "来源消息（可选）",
          type: "select",
          options: [
            { value: "", label: "直接记录" },
            ...(w?.messages.map((r) => ({
              value: str(r, "id"),
              label: str(r, "content").slice(0, 60),
            })) ?? []),
          ],
          optional: true,
        },
        {
          key: "supersedesId",
          label: "替代哪条旧重点（可选）",
          type: "select",
          options: [
            { value: "", label: "新增重点" },
            ...(w?.highlights
              .filter((r) => r.status === "confirmed")
              .map((r) => ({
                value: str(r, "id"),
                label: str(r, "content").slice(0, 60),
              })) ?? []),
          ],
          optional: true,
        },
      ];
  }
}
export const titles: Record<FormKind, string> = {
  story: "导入故事",
  project: "创建项目",
  workflow: "新建流程草案",
  node: "添加流程节点",
  agent: "添加节点 AI",
  session: "建立讨论会话",
  document: "保存故事文稿",
  asset: "登记资产",
  item: "新建工作事项",
  highlight: "记录核心重点",
};
export const endpoints: Record<FormKind, string> = {
  story: "stories",
  project: "projects",
  workflow: "workflows",
  node: "nodes",
  agent: "agents",
  session: "sessions",
  document: "documents",
  asset: "assets",
  item: "items",
  highlight: "highlights",
};
