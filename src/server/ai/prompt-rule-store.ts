import { readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "../database";
import { agentKeys, type AgentKey } from "../../domain/agent-config";
import { ensure } from "../errors";

export const SEED_RULES_VERSION = "2026-09-21.11";
const upgradesFrom = [
  "2026-09-21.10",
  "2026-09-21.9",
  "2026-09-21.8",
  "2026-09-21.7",
  "2026-09-21.6",
  "2026-09-21.5",
  "2026-09-21.4",
  "2026-09-21.3",
  "2026-09-21.2",
  "2026-09-21.1",
  "2026-09-20.12",
  "2026-09-20.11",
  "2026-09-20.10",
  "2026-09-20.9",
  "2026-09-20.8",
  "2026-09-20.7",
  "2026-09-20.6",
  "2026-09-20.5",
  "2026-09-20.4",
  "2026-09-20.3",
  "2026-09-20.2",
  "2026-09-20.1",
  "2026-09-19.4",
  "2026-09-17.1",
  "2026-09-19.1",
  "2026-09-19.2",
  "2026-09-19.3",
];
const ruleKeys = [
  "system",
  "developer",
  "custom-intro",
  "custom-empty",
  ...agentKeys,
];

/** Markdown files seed versioned releases. Upgrades append a new set; old rules and snapshots remain immutable. */
export function seedPromptRules(db: Database) {
  const current = db.one<{ version: string }>(
    "SELECT version FROM prompt_rule_selection WHERE id=1",
  );
  if (current && !upgradesFrom.includes(current.version)) return;
  db.transaction(() => {
    const selected = db.one<{ version: string }>(
      "SELECT version FROM prompt_rule_selection WHERE id=1",
    );
    if (selected && !upgradesFrom.includes(selected.version)) return;
    if (
      db.one(
        "SELECT version FROM prompt_rule_sets WHERE version=?",
        SEED_RULES_VERSION,
      )
    ) {
      const count = db.one<{ n: number }>(
        "SELECT count(*) n FROM prompt_rule_texts WHERE version=?",
        SEED_RULES_VERSION,
      )!.n;
      ensure(count === ruleKeys.length, "已发布提示词不完整");
      db.run(
        "UPDATE prompt_rule_selection SET version=? WHERE id=1",
        SEED_RULES_VERSION,
      );
      return;
    }
    const bodies = ruleKeys.map((key) => ({
      key,
      body: readFileSync(
        path.join(process.cwd(), "src/server/ai/rules", `${key}.md`),
        "utf8",
      ).trim(),
    }));
    ensure(
      bodies.every((rule) => rule.body),
      "默认提示词不完整，无法初始化",
    );
    db.run(
      "INSERT INTO prompt_rule_sets(version,created_at) VALUES(?,?)",
      SEED_RULES_VERSION,
      new Date().toISOString(),
    );
    for (const rule of bodies)
      db.run(
        "INSERT INTO prompt_rule_texts(version,rule_key,body) VALUES(?,?,?)",
        SEED_RULES_VERSION,
        rule.key,
        rule.body,
      );
    db.run(
      "INSERT INTO prompt_rule_selection(id,version) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version",
      SEED_RULES_VERSION,
    );
  });
}

export function readPromptRules(db: Database, key: AgentKey) {
  const rows = db.all<{ version: string; rule_key: string; body: string }>(
    `SELECT t.version,t.rule_key,t.body
    FROM prompt_rule_selection s JOIN prompt_rule_texts t ON t.version=s.version
    WHERE s.id=1 AND t.rule_key IN ('system','developer','custom-intro','custom-empty',?)`,
    key,
  );
  ensure(
    rows.length === 5 && rows.every((row) => row.body.trim()),
    "数据库中的提示词不完整，请检查已发布规则",
  );
  const bodies = Object.fromEntries(
    rows.map((row) => [row.rule_key, row.body]),
  );
  return {
    version: rows[0].version,
    system: bodies.system,
    role: bodies[key],
    developer: bodies.developer,
    customIntro: bodies["custom-intro"],
    customEmpty: bodies["custom-empty"],
  };
}
