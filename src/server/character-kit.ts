import { characterKits } from "../domain/character-kit";
import type { StudioService } from "./studio-service";
import { ensure } from "./errors";

export function characterReadiness(
  service: StudioService,
  p: string,
  taskId: string,
  referenceFileIds: string[] = [],
) {
  const project = service.project(p);
  const available = new Set(
    service.db
      .all<{ task_id: string }>(
        `SELECT DISTINCT a.task_id FROM assets a
     JOIN output_files o ON o.project_id=a.project_id AND o.task_id=a.task_id AND o.revision=a.output_revision
     JOIN files f ON f.id=o.file_id
     WHERE a.project_id=? AND f.mime LIKE 'image/%'
     AND a.output_revision=(SELECT MAX(revision) FROM outputs WHERE project_id=a.project_id AND task_id=a.task_id)
     AND NOT EXISTS (SELECT 1 FROM image_trash t WHERE t.file_id=f.id)`,
        p,
      )
      .map((row) => row.task_id)
      .filter((id) => project.assets.some((a) => a.taskId === id)),
  );
  const references = referenceFileIds.flatMap((fileId) =>
    service.db
      .all<{ task_id: string }>(
        "SELECT task_id FROM output_files WHERE project_id=? AND file_id=?",
        p,
        fileId,
      )
      .map((row) => row.task_id),
  );
  // Keep identity links for returned/retired assets too; their absence must not
  // make a downstream branch look as though it contains no characters.
  const links = service.db.all<{ id: string; task_id: string }>(
    "SELECT id,task_id FROM assets WHERE project_id=?",
    p,
  );
  for (const link of links)
    if (!project.assets.some((a) => a.id === link.id))
      project.assets.push({
        id: link.id,
        taskId: link.task_id,
        name: link.id,
        category: "人物",
        status: "draft",
        description: "",
        version: 0,
        sourceIds: [],
      });
  return characterKits(project, taskId, available, references);
}

export function requireCharacterKits(
  service: StudioService,
  p: string,
  taskId: string,
  referenceFileIds: string[] = [],
) {
  const missing = characterReadiness(
    service,
    p,
    taskId,
    referenceFileIds,
  ).filter((kit) => !kit.ready);
  ensure(
    !missing.length,
    `角色规范图尚未齐备：${missing.map((kit) => `${kit.name} 缺少 ${kit.missing.join("、")}`).join("；")}。请先由资产制作 AI 补齐并独立审核，不能以首样代替完整角色资产。`,
    "CHARACTER_KIT_INCOMPLETE",
    409,
  );
}
