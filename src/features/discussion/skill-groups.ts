import type { SkillEntry } from "@/domain/skills";
const groups = [
  {
    title: "原作与编剧",
    note: "事实 → 改编 → 分集 → 单集剧本",
    ids: [
      "source-analysis",
      "novel-adaptation",
      "episode-planning",
      "episode-writing",
    ],
  },
  {
    title: "分镜设计",
    note: "镜头目的、连续性与制作交接",
    ids: ["storyboard-design"],
  },
  {
    title: "文生图与画风",
    note: "按图种选择方法，确定统一画风",
    ids: ["drama-text-to-image", "visual-style"],
  },
  {
    title: "人物与服装",
    note: "身份一致性、五官、姿态与衣装",
    ids: [
      "character-reference",
      "face-expression",
      "hair-grooming",
      "pose-contact",
      "costume-material",
    ],
  },
  {
    title: "场景、布光与修图",
    note: "场景道具、画面组织与局部返修",
    ids: ["environment-props", "lighting-composition", "image-revision"],
  },
];
export function groupSkills(items: SkillEntry[], query = "") {
  const needle = query.trim().toLowerCase();
  const known = new Set(groups.flatMap((g) => g.ids));
  return [
    ...groups,
    {
      title: "其他技能",
      note: "其他按需方法",
      ids: items.filter((i) => !known.has(i.id)).map((i) => i.id),
    },
  ]
    .map((group) => ({
      ...group,
      items: group.ids
        .map((id) => items.find((i) => i.id === id))
        .filter(
          (i): i is SkillEntry =>
            !!i &&
            (!needle ||
              `${group.title} ${i.title} ${i.description}`
                .toLowerCase()
                .includes(needle)),
        ),
    }))
    .filter((group) => group.items.length);
}
export function skillSectionLabel(name: string, body: string) {
  if (name === "SKILL.md" || name === "main") return "制作方法";
  if (name === "review.md") return "审核要点";
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "参考章节";
}
