import type { Database } from "./database";

/** Preserve old results; retire only speculative, never-filled node placeholders. */
export function markLegacyScaffolding(db: Database, version: number) {
  if (version >= 5) return;
  db.run(`INSERT OR IGNORE INTO legacy_scaffolding(project_id,task_id)
    SELECT t.project_id,t.id FROM tasks t WHERE t.kind IN ('episode','board','assembly')
    AND NOT EXISTS(SELECT 1 FROM outputs o WHERE o.project_id=t.project_id AND o.task_id=t.id)
    AND NOT EXISTS(SELECT 1 FROM files f WHERE f.project_id=t.project_id AND f.task_id=t.id)`);
  // The new per-episode storyboard starts from existing episode text, never rewrites it.
  for (const t of db.all<{
    project_id: string;
    id: string;
    episode: number;
  }>(`SELECT t.* FROM tasks t WHERE t.kind='episode'
    AND EXISTS(SELECT 1 FROM outputs o WHERE o.project_id=t.project_id AND o.task_id=t.id)`)) {
    const id = `episode-${t.episode}-storyboard`;
    db.run(
      "INSERT OR IGNORE INTO tasks VALUES(?,?,?,?,?,?,?,?,?)",
      t.project_id,
      id,
      "storyboard",
      `第 ${t.episode} 集 · 分镜设计`,
      "依据本集已验收剧本逐步拆镜，保留已经制作的镜头。",
      t.episode,
      null,
      1,
      1,
    );
    db.run(
      "INSERT OR IGNORE INTO dependencies VALUES(?,?,?)",
      t.project_id,
      id,
      t.id,
    );
  }
}
