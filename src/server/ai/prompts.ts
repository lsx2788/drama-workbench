import type { Actor } from "../contracts";
import type { TaskKind } from "../../domain/types";
import {
  agentKeys,
  customFieldLabels,
  type AgentKey,
  type CustomInstructions,
} from "../../domain/agent-config";

export const toolLabels = {
  read_skill: "按需读取制作技巧或审核要点",
  resolve_image_feedback: "处理用户图片意见并退回修改",
  image_inventory: "查看图片版本、提示词来源与使用位置",
  recycle_image: "将不再需要的图片移入垃圾篓或恢复",
  recycle_paused_asset: "清理或恢复暂停的未定稿资产任务",
  project: "查询当前任务与已通过资产",
  read_material: "按需读取原始资料",
  act: "保存产出或提交审核决定",
  delegate: "委派制作（系统自动送审）",
  ask_node: "向节点审核提出疑问",
  review_question: "审核问题是否需要上报",
  answer_question: "回答上报问题并恢复制作",
  generate_image: "生成真实图片并保存待审核产出",
  propose_plan: "提出流程方案",
  confirm_plan: "记录用户确认并建立流程",
  ask_user: "向用户发起待确认问题",
};
export function toolsForRole(role: Actor["role"], kind?: string) {
  return role === "coordinator"
    ? [
        "project",
        "read_skill",
        "resolve_image_feedback",
        "read_material",
        "act",
        "delegate",
        "propose_plan",
        "confirm_plan",
        "ask_user",
        "answer_question",
        "generate_image",
        "image_inventory",
        "recycle_image",
        "recycle_paused_asset",
      ]
    : [
        "project",
        ...([
          "source",
          "script",
          "episode",
          "assets",
          "frames",
          "storyboard",
          "board",
          "reviewer",
        ].includes(kind ?? "")
          ? ["read_skill"]
          : []),
        "read_material",
        "act",
        role === "reviewer" ? "review_question" : "ask_node",
        ...(role === "executor" && (kind === "assets" || kind === "frames")
          ? ["generate_image"]
          : []),
        ...(["assets", "frames"].includes(kind ?? "")
          ? ["image_inventory", "recycle_image"]
          : []),
      ];
}
export function keyForActor(actor: Actor, kind?: TaskKind): AgentKey {
  if (actor.role === "coordinator") return "coordinator";
  if (actor.role === "executor" && kind === "storyboard") return "board";
  if (actor.role === "reviewer") return "reviewer";
  if (actor.role === "executor" && kind && agentKeys.includes(kind as AgentKey))
    return kind as AgentKey;
  throw new Error("此节点没有自动制作 AI；制作需求由总控处理，视频由人工处理");
}
export function customRules(
  fields: CustomInstructions,
  intro: string,
  empty: string,
) {
  const sections = Object.entries(customFieldLabels)
    .filter(([key]) => fields[key as keyof CustomInstructions].trim())
    .map(
      ([key, label]) =>
        `## ${label}\n${fields[key as keyof CustomInstructions].trim()}`,
    );
  return `${intro}\n\n${sections.join("\n\n") || empty}`;
}
