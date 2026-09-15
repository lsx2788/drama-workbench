import type { Store } from "./db";
import { STRUCTURED_COORDINATOR_INSTRUCTIONS } from "./coordinator-instructions";

export const COORDINATOR_INTAKE_POLICY =
  "开始制作前，先阅读故事原文和用户提供的信息，整理已知条件与待确认问题。优先确认画面风格、制作范围、改编边界、单集时长、画幅，以及用户特别在意的要求；已明确的信息不要重复询问，未填写的内容不要擅自设定。根据故事提出建议，分批询问关键问题，避免一次抛出冗长问卷。汇总基本制作信息并请用户确认；在关键方向确认前，不开始剧本拆解、分镜制作或资产生成，也不建立正式生产流程。确认后再按实际需要调用接口保存结论并推进工作。";

export const DEFAULT_COORDINATOR_INSTRUCTIONS =
  STRUCTURED_COORDINATOR_INSTRUCTIONS;

/** Numbered migration: retire intake options and extend existing coordinator instructions once. */
export function migrateCoordinatorIntake(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT version FROM schema_migrations WHERE version=9")) return;
    s.run(
      "UPDATE story_preference_categories SET enabled=0 WHERE id='platform'",
    );
    s.run(
      "UPDATE story_preference_options SET enabled=0 WHERE value='discuss'",
    );
    s.run(
      "UPDATE agents SET instructions=CASE WHEN instructions='' THEN ? ELSE instructions || char(10) || char(10) || ? END, config_version=config_version+1 WHERE node_id IN (SELECT id FROM nodes WHERE node_type='coordinator') AND instr(instructions,?)=0",
      COORDINATOR_INTAKE_POLICY,
      COORDINATOR_INTAKE_POLICY,
      COORDINATOR_INTAKE_POLICY,
    );
    s.run("INSERT INTO schema_migrations VALUES(9,datetime('now'))");
  });
}
