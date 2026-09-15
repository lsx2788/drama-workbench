import type { Store } from "./db";
import type { PreferenceCategory } from "../shared/story-preferences";
import { INITIAL_STORY_PREFERENCES } from "./story-preference-seed";

export function initializeStoryPreferences(s: Store) {
  s.transaction(() => {
    if (s.one("SELECT version FROM schema_migrations WHERE version=8")) return;
    s.db.exec(`
      CREATE TABLE story_preference_categories (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL,
        position INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
      );
      CREATE TABLE story_preference_options (
        category_id TEXT NOT NULL REFERENCES story_preference_categories(id),
        value TEXT NOT NULL, label TEXT NOT NULL, detail_label TEXT,
        position INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        PRIMARY KEY(category_id,value)
      );
    `);
    INITIAL_STORY_PREFERENCES.forEach((category, position) => {
      s.run(
        "INSERT INTO story_preference_categories VALUES(?,?,?,?,1)",
        category.id,
        category.label,
        category.description,
        position,
      );
      category.options.forEach((option, index) => {
        s.run(
          "INSERT INTO story_preference_options VALUES(?,?,?,?,?,1)",
          category.id,
          option.value,
          option.label,
          option.detailLabel ?? null,
          index,
        );
      });
    });
    s.run("INSERT INTO schema_migrations VALUES(8,datetime('now'))");
  });
}

export function listStoryPreferences(s: Store): PreferenceCategory[] {
  const options = s.all(
    "SELECT * FROM story_preference_options WHERE enabled=1 ORDER BY position,value",
  );
  return s
    .all(
      "SELECT * FROM story_preference_categories WHERE enabled=1 ORDER BY position,id",
    )
    .map((category) => ({
      id: String(category.id),
      label: String(category.label),
      description: String(category.description),
      options: options
        .filter((option) => option.category_id === category.id)
        .map((option) => ({
          value: String(option.value),
          label: String(option.label),
          ...(option.detail_label
            ? { detailLabel: String(option.detail_label) }
            : {}),
        })),
    }))
    .filter((category) => category.options.length > 0);
}
