export interface WorkflowOutline {
  title: string;
  summary: string;
  steps: {
    key: string;
    name: string;
    objective: string;
    outputs: string[];
    dependsOn: string[];
  }[];
  questions: string[];
}

export const FIXED_OUTLINE_STEPS: WorkflowOutline["steps"] = [
  {
    key: "fixed_coordinator",
    name: "总控",
    objective: "与用户明确制作需求，组织协作并审核各阶段成果。",
    outputs: ["制作需求与审核结论"],
    dependsOn: [],
  },
  {
    key: "fixed_source_analysis",
    name: "原文分析",
    objective: "按需读取原文，整理故事概况、内容依据与尚未明确的问题。",
    outputs: ["原作概况与来源依据"],
    dependsOn: ["fixed_coordinator"],
  },
  {
    key: "fixed_screenwriting",
    name: "编剧",
    objective: "根据已确认需求形成改编框架，按作品需要规划分集或单条作品。",
    outputs: ["改编框架与内容范围"],
    dependsOn: ["fixed_source_analysis"],
  },
];
export const FIXED_OUTLINE_KEYS = new Set(
  FIXED_OUTLINE_STEPS.map((s) => s.key),
);
export const OUTLINE_CONTINUATION_KEY = "fixed_screenwriting";

/** Shared display projection for legacy outlines; never rewrites their stored revisions. */
export function withFixedOutlineStart(
  steps: WorkflowOutline["steps"],
): WorkflowOutline["steps"] {
  return [
    ...FIXED_OUTLINE_STEPS.map((s) => ({
      ...s,
      outputs: [...s.outputs],
      dependsOn: [...s.dependsOn],
    })),
    ...steps
      .filter((s) => !FIXED_OUTLINE_KEYS.has(s.key))
      .map((s) => ({
        ...s,
        dependsOn: s.dependsOn.length
          ? [...s.dependsOn]
          : [OUTLINE_CONTINUATION_KEY],
      })),
  ];
}

export function initialWorkflowOutline(): WorkflowOutline {
  return {
    title: "制作流程",
    summary:
      "总控、原文分析、编剧为固定环节。后续制作流程由总控结合需求继续完善。",
    steps: withFixedOutlineStart([]),
    questions: [],
  };
}
