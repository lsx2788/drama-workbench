import type { Database } from "./database";
import type { StudioProject, Task } from "../domain/types";
import type { OutputStructure } from "../domain/expansion";
import { taskDefinition } from "../domain/structure";
import { epId, shotId } from "../domain/queries";
import { ensure } from "./errors";
import { randomUUID } from "node:crypto";

/** Called inside the acceptance transaction. Materializes only approved, populated slices. */
export function expandAccepted(
  db: Database,
  project: StudioProject,
  task: Task,
) {
  const row = db.one<{ body: string }>(
    "SELECT body FROM output_structures WHERE project_id=? AND task_id=? AND revision=?",
    project.id,
    task.id,
    task.revision,
  );
  if (!row) return;
  ensure(project.confirmed, "请先确认制作流程骨架");
  const body = JSON.parse(row.body) as OutputStructure;
  const p = project.id,
    time = new Date().toISOString();
  const priorAcceptance = db.one<{ revision: number }>(
    "SELECT MAX(revision) revision FROM reviews WHERE project_id=? AND task_id=? AND stage='acceptance' AND decision='pass' AND revision<?",
    p,
    task.id,
    task.revision,
  )?.revision;
  const userRevision =
    !!priorAcceptance &&
    !!db.one(
      "SELECT id FROM events WHERE project_id=? AND task_id=? AND action='user-return' AND revision=?",
      p,
      task.id,
      priorAcceptance,
    );
  const invalidated = new Set<string>();
  const invalidateDependents = (id: string) => {
    for (const dependent of Object.values(project.tasks).filter((item) =>
      item.dependencies.includes(id),
    )) {
      if (invalidated.has(dependent.id)) continue;
      invalidated.add(dependent.id);
      ensure(
        !db.one(
          "SELECT id FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('working','reviewing','revising','continuing')",
          p,
          dependent.id,
        ),
        "下游仍在执行，请先等待完成再验收上游修订",
      );
      if (dependent.revision) {
        const reason = `上游 ${task.title} v${task.revision} 根据用户意见修订，需重新核对本节点；旧文件保留。`;
        db.run(
          "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          dependent.id,
          dependent.revision,
          "acceptance",
          "return",
          "system",
          reason,
          time,
        );
        db.run(
          "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          dependent.id,
          "return",
          dependent.revision,
          "system",
          reason,
          time,
        );
      }
      invalidateDependents(dependent.id);
    }
  };
  const insert = (t: Task, text?: string) => {
    const existing = project.tasks[t.id];
    if (existing && !existing.placeholder) {
      if (
        userRevision &&
        text &&
        (existing.text !== text ||
          existing.title !== t.title ||
          existing.delivery !== "approved")
      ) {
        ensure(
          !db.one(
            "SELECT id FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('working','reviewing','revising','continuing')",
            p,
            t.id,
          ),
          "对应分支仍在执行，请稍后验收修订",
        );
        const revision = existing.revision + 1;
        db.run(
          "INSERT INTO outputs VALUES(?,?,?,?,?,?,?,?,?,?)",
          p,
          t.id,
          revision,
          text,
          "[]",
          "",
          null,
          null,
          "system",
          time,
        );
        db.run(
          "UPDATE tasks SET title=?,objective=? WHERE project_id=? AND id=?",
          t.title,
          t.objective,
          p,
          t.id,
        );
        db.run(
          "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          t.id,
          revision,
          "acceptance",
          "pass",
          "system",
          `由用户退回后重新验收的 ${task.title} v${task.revision} 更新对应片段`,
          time,
        );
        db.run(
          "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          t.id,
          "materialized",
          revision,
          "system",
          `根据 ${task.title} v${task.revision} 更新；旧版本保留`,
          time,
        );
        invalidateDependents(t.id);
        return;
      }
      ensure(
        text &&
          existing.text === text &&
          existing.title === t.title &&
          existing.delivery === "approved",
        "已有节点内容不同，不能覆盖已开展分支",
      );
      return;
    }
    if (existing?.placeholder) {
      db.run(
        "DELETE FROM dependencies WHERE project_id=? AND task_id=?",
        p,
        t.id,
      );
      db.run(
        "DELETE FROM legacy_scaffolding WHERE project_id=? AND task_id=?",
        p,
        t.id,
      );
      db.run(
        "UPDATE tasks SET title=?,objective=?,enabled=1,review_enabled=? WHERE project_id=? AND id=?",
        t.title,
        t.objective,
        +t.reviewEnabled,
        p,
        t.id,
      );
    } else {
      ensure(
        !db.one("SELECT id FROM tasks WHERE project_id=? AND id=?", p, t.id),
        "此分支已存在，不能覆盖已开展的任务",
      );
      db.run(
        "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)",
        p,
        t.id,
        t.kind,
        t.title,
        t.objective,
        t.episode ?? null,
        t.shot ?? null,
        1,
        +t.reviewEnabled,
      );
    }
    for (const dep of t.dependencies)
      db.run("INSERT INTO dependencies VALUES(?,?,?)", p, t.id, dep);
    if (text) {
      db.run(
        "INSERT INTO outputs VALUES(?,?,?,?,?,?,?,?,?,?)",
        p,
        t.id,
        1,
        text,
        "[]",
        "",
        null,
        null,
        "system",
        time,
      );
      db.run(
        "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)",
        randomUUID(),
        p,
        t.id,
        1,
        "acceptance",
        "pass",
        "system",
        `来源：${task.title} v${task.revision} 已验收产出的对应部分`,
        time,
      );
      db.run(
        "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
        randomUUID(),
        p,
        t.id,
        "materialized",
        1,
        "system",
        `由 ${task.title} v${task.revision} 已验收产出建立；${body.reason}`,
        time,
      );
    }
  };
  if (body.kind === "episodes") {
    ensure(task.kind === "script", "只有编剧产出可以展开剧集");
    for (const item of body.items) {
      const existing = project.episodes.find((e) => e.number === item.number);
      if (
        existing &&
        !project.tasks[epId(item.number)]?.placeholder &&
        !userRevision
      )
        ensure(
          existing.title === item.title && existing.synopsis === item.synopsis,
          "不能改写已有剧集信息",
        );
      else
        db.run(
          "INSERT INTO episodes VALUES(?,?,?,?,?) ON CONFLICT(project_id,number) DO UPDATE SET title=excluded.title,synopsis=excluded.synopsis",
          p,
          item.number,
          item.title,
          item.synopsis,
          0,
        );
      insert(
        taskDefinition(
          epId(item.number),
          "episode",
          `第 ${item.number} 集 · ${item.title}`,
          [task.id],
          item.number,
        ),
        item.text,
      );
      if (!project.tasks[`episode-${item.number}-storyboard`])
        insert(
          taskDefinition(
            `episode-${item.number}-storyboard`,
            "storyboard",
            `第 ${item.number} 集 · 分镜设计`,
            [epId(item.number)],
            item.number,
          ),
        );
    }
    ensure(
      !project.representativeEpisode ||
        project.tasks[epId(project.representativeEpisode)]?.placeholder ||
        project.representativeEpisode === body.representative,
      "已有关键剧集基准不能在增补时更换",
    );
    db.run(
      "UPDATE projects SET representative_episode=? WHERE id=?",
      body.representative,
      p,
    );
  } else {
    ensure(
      task.kind === "storyboard" && task.episode,
      "只有本集分镜设计可以展开镜头",
    );
    const n = task.episode;
    for (const item of body.items) {
      const shotTasks = (["board", "assets", "frames", "video"] as const).map(
        (kind, index) =>
          taskDefinition(
            shotId(n, item.number, kind),
            kind,
            {
              board: item.title,
              assets: "基础资产准备",
              frames: "镜头画面制作",
              video: "镜头视频 · 人工处理",
            }[kind],
            [
              index
                ? shotId(
                    n,
                    item.number,
                    ["board", "assets", "frames"][index - 1],
                  )
                : task.id,
            ],
            n,
            item.number,
          ),
      );
      for (const t of shotTasks) {
        if (t.kind === "board") {
          t.title = item.title;
          t.dependencies = [task.id];
        }
        if (t.kind === "board" || !project.tasks[t.id])
          insert(t, t.kind === "board" ? item.text : undefined);
      }
    }
    const videos = db.all<{ id: string }>(
      "SELECT id FROM tasks WHERE project_id=? AND episode=? AND kind='video' AND NOT EXISTS(SELECT 1 FROM legacy_scaffolding l WHERE l.project_id=tasks.project_id AND l.task_id=REPLACE(tasks.id,'-video','-board')) ORDER BY shot",
      p,
      n,
    );
    const assembly = project.tasks[`episode-${n}-assembly`];
    if (!assembly || assembly.placeholder)
      insert(
        taskDefinition(
          `episode-${n}-assembly`,
          "assembly",
          `第 ${n} 集视频`,
          [task.id, ...videos.map((v) => v.id)],
          n,
        ),
      );
    else {
      const added = videos.filter((v) => !assembly.dependencies.includes(v.id));
      ensure(
        !added.length || !assembly.revision,
        "整集视频已开始制作，不能增加镜头输入",
      );
      for (const v of added)
        db.run("INSERT INTO dependencies VALUES(?,?,?)", p, assembly.id, v.id);
    }
    const focus = db.one<{ shot: number }>(
      "SELECT shot FROM episode_focus WHERE project_id=? AND episode=?",
      p,
      n,
    );
    ensure(
      !focus || focus.shot === body.representative,
      "已有关键镜头基准不能在增补时更换",
    );
    db.run(
      "UPDATE episodes SET shots=? WHERE project_id=? AND number=?",
      videos.length,
      p,
      n,
    );
    db.run(
      "INSERT OR IGNORE INTO episode_focus VALUES(?,?,?)",
      p,
      n,
      body.representative,
    );
    if (project.representativeEpisode === n)
      db.run(
        "UPDATE projects SET representative_shot=? WHERE id=?",
        body.representative,
        p,
      );
  }
}
