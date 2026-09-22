import { readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "../database";
import { ensure } from "../errors";
import type { AgentKey } from "../../domain/agent-config";
import type { TaskKind } from "../../domain/types";

export const SKILL_VERSION = "2026-09-21.3";
const upgradesFrom = ["2026-09-21.1", "2026-09-21.2"];
const definitions = [
  ["source-analysis", "原作事实与改编依据", ["evidence.md"]],
  [
    "novel-adaptation",
    "原作转整体剧本",
    ["dramatic-adaptation.md", "genre-structure.md"],
  ],
  ["episode-planning", "剧本分集与容量规划", ["episode-cards.md"]],
  [
    "episode-writing",
    "单集剧本与场景对白",
    ["scene-dialogue.md", "continuity.md"],
  ],
  [
    "storyboard-design",
    "剧集转分镜",
    ["coverage-continuity.md", "timing-handoff.md"],
  ],
  [
    "drama-text-to-image",
    "短剧文生图助手",
    [
      "characters.md",
      "costumes.md",
      "environments.md",
      "interiors.md",
      "equipment-props.md",
      "vehicles.md",
      "creatures.md",
      "effects.md",
      "shot-frames.md",
      "graphic-inserts.md",
    ],
  ],
  [
    "visual-style",
    "题材与画风",
    ["realistic.md", "animation.md", "speculative.md", "period-modern.md"],
  ],
  ["character-reference", "人物定稿与规范图", []],
  ["face-expression", "面部与表情", []],
  ["hair-grooming", "发型与毛发", []],
  ["pose-contact", "姿态与手部接触", []],
  ["costume-material", "服装与材质", []],
  ["lighting-composition", "布光与构图", []],
  ["environment-props", "场景与道具", []],
  ["image-revision", "局部返修", []],
] as const;
export type SkillDocument = {
  id: string;
  title: string;
  description: string;
  resources: Record<string, string>;
  scope?: { production: AgentKey[]; review: TaskKind[] };
};

const writingScopes: Record<string, NonNullable<SkillDocument["scope"]>> = {
  "source-analysis": { production: ["source"], review: ["source"] },
  "novel-adaptation": { production: ["script"], review: ["script"] },
  "episode-planning": { production: ["script"], review: ["script"] },
  "episode-writing": { production: ["episode"], review: ["episode"] },
  "storyboard-design": {
    production: ["board"],
    review: ["storyboard", "board"],
  },
};

/** Source packages seed an immutable database release; execution never reads loose files. */
export function seedSkills(db: Database) {
  const canUpgrade = () => {
    const selected = db.one<{ version: string }>(
      "SELECT version FROM skill_selection WHERE id=1",
    );
    return !selected || upgradesFrom.includes(selected.version);
  };
  if (!canUpgrade()) return;
  const docs = definitions.map(([id, title, references]) => {
    const base = path.join(process.cwd(), "src/server/ai/skills", id);
    const source = readFileSync(path.join(base, "SKILL.md"), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const match = source.match(
      /^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n([\s\S]+)$/,
    );
    ensure(match && match[1] === id, `Skill 元数据无效：${id}`);
    const resources: Record<string, string> = Object.fromEntries([
      ["SKILL.md", match[3].trim()],
      ["review.md", readFileSync(path.join(base, "review.md"), "utf8").trim()],
      ...references.map((name) => [
        `references/${name}`,
        readFileSync(path.join(base, "references", name), "utf8").trim(),
      ]),
    ]);
    ensure(
      Object.values(resources).every((body) => body.length > 0),
      `Skill 内容缺失：${id}`,
    );
    const scope = writingScopes[id] ?? {
      production: ["assets", "frames", "board"],
      review: ["assets", "frames", "storyboard", "board"],
    };
    return { id, title, description: match[2], resources, scope };
  });
  db.transaction(() => {
    if (!canUpgrade()) return;
    const existing = db.one(
      "SELECT version FROM skill_releases WHERE version=?",
      SKILL_VERSION,
    );
    if (existing) {
      const published = db.all<{ skill_id: string; body: string }>(
        "SELECT skill_id,body FROM skill_documents WHERE version=?",
        SKILL_VERSION,
      );
      ensure(
        published.length === docs.length &&
          docs.every((doc) =>
            published.some((row) => {
              if (row.skill_id !== doc.id) return false;
              const stored = JSON.parse(row.body) as SkillDocument;
              return (
                stored.id === doc.id &&
                JSON.stringify(stored.scope) === JSON.stringify(doc.scope) &&
                Object.keys(doc.resources).every(
                  (key) =>
                    typeof stored.resources?.[key] === "string" &&
                    stored.resources[key].trim(),
                )
              );
            }),
          ),
        "已发布 Skill 不完整",
      );
    } else {
      db.run(
        "INSERT INTO skill_releases VALUES(?,?)",
        SKILL_VERSION,
        new Date().toISOString(),
      );
      for (const doc of docs)
        db.run(
          "INSERT INTO skill_documents VALUES(?,?,?)",
          SKILL_VERSION,
          doc.id,
          JSON.stringify(doc),
        );
    }
    db.run(
      "INSERT INTO skill_selection VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version",
      SKILL_VERSION,
    );
  });
}
