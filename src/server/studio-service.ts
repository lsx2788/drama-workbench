import { expandAccepted } from "./expansion";
import { requireCharacterKits } from "./character-kit";
import { isCharacterBasis } from "../domain/character-basis";
import { imageInventory } from "./image-trash";
import { messageReferences } from "./ai/task-references";
import { structureSchema, planSchema } from "./contracts";
import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { ensure } from "./errors";
import { changeTask, type TaskAction } from "../domain/commands";
import { emptyProject, productionTasks } from "../domain/structure";
import type { Delivery, StudioProject, Task, MediaFile } from "../domain/types";
import { saveDimensions, storedDimensions } from "./image-metadata";
import type { Actor, Plan } from "./contracts";

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const names = {
  human: "你",
  coordinator: "总控 AI",
  executor: "制作 AI",
  reviewer: "独立审核 AI",
};
export class StudioService {
  constructor(readonly db: Database) {}
  pendingFeedback(p: string, taskId?: string) {
    return this.db.all<Row>(
      "SELECT f.*,m.text FROM image_feedback f JOIN messages m ON m.id=f.message_id WHERE f.project_id=? AND f.status='pending' AND (? IS NULL OR f.task_id=?) ORDER BY m.seq",
      p,
      taskId ?? null,
      taskId ?? null,
    );
  }
  resolveFeedback(
    p: string,
    messageId: string,
    revision: number,
    decision: "revise" | "keep",
    reason: string,
  ) {
    return this.db.transaction(() => {
      const item = this.db.one<Row>(
        "SELECT * FROM image_feedback WHERE project_id=? AND message_id=?",
        p,
        messageId,
      );
      ensure(item, "找不到对应用户图片意见");
      if (item.status !== "pending")
        return { status: item.status, resolution: item.resolution };
      const task = this.project(p).tasks[item.task_id];
      ensure(
        task.revision === revision,
        "产出已更新，请重新核对用户引用版本与当前版本",
        "CONFLICT",
        409,
      );
      ensure(reason.trim(), "请说明如何处理用户意见");
      ensure(
        !this.db.one(
          "SELECT id FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('working','reviewing','revising','continuing')",
          p,
          task.id,
        ),
        "节点仍在执行，等待系统安全交回后再处理意见",
      );
      this.db.run(
        "UPDATE image_feedback SET status=?,resolution=? WHERE message_id=?",
        decision,
        reason,
        messageId,
      );
      if (decision === "revise")
        this.act(
          p,
          task.id,
          { type: "return", reason },
          { role: "coordinator" },
          revision,
          "",
          undefined,
          [],
          false,
          messageId,
        );
      this.message(
        p,
        "总控 AI",
        "coordinator",
        `${decision === "revise" ? "已根据你的意见退回修改" : "已核对你的意见，保留当前版本"}：${task.title} v${revision}。\n\n${reason}`,
        task.id,
        undefined,
        { audience: "human", replyToId: messageId },
      );
      return {
        status: decision,
        taskId: task.id,
        revision,
        quotedRevision: item.revision,
        instruction:
          decision === "revise"
            ? "请将用户意见和本次修改要求交给原制作 AI，保存新版后重新独立审核。其他待处理意见一并处理后再委派。"
            : "如曾暂停内部审核，请重新委派原节点继续审核与交付，不能跳过审核。",
      };
    });
  }
  private bump(id: string) {
    this.db.run("UPDATE projects SET version=version+1 WHERE id=?", id);
  }
  messageImages(p: string, messageId: string) {
    return this.db
      .all<Row>(
        "SELECT f.* FROM message_files a JOIN files f ON f.id=a.file_id JOIN messages m ON m.id=a.message_id WHERE m.project_id=? AND f.project_id=? AND m.id=? ORDER BY a.rowid",
        p,
        p,
        messageId,
      )
      .map((f) => this.fileView(f));
  }
  attachMessageImages(p: string, messageId: string, files: StoredUpload[]) {
    ensure(
      this.db.one(
        "SELECT id FROM messages WHERE id=? AND project_id=? AND role='human'",
        messageId,
        p,
      ),
      "只能为本剧本的用户消息添加附件",
    );
    ensure(
      files.length <= 5 &&
        files.every(
          (f) =>
            f.size > 0 &&
            (f.mime.startsWith("image/")
              ? ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
                  f.mime,
                ) && f.size <= 10 * 1024 * 1024
              : [
                  "text/plain",
                  "application/pdf",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ].includes(f.mime) && f.size <= 20 * 1024 * 1024),
        ) &&
        files.reduce((n, f) => n + f.size, 0) <= 30 * 1024 * 1024,
      "聊天附件超出数量、类型或大小限制",
    );
    for (const file of files) {
      this.insertFile(p, null, "source", file);
      this.db.run("INSERT INTO message_files VALUES(?,?)", messageId, file.id);
    }
  }
  private check(id: string, version?: number) {
    const row = this.db.one<Row>("SELECT * FROM projects WHERE id=?", id);
    ensure(row, "找不到剧本", "NOT_FOUND", 404);
    if (version !== undefined)
      ensure(
        row.version === version,
        "内容已被更新，请重新查看后再操作",
        "CONFLICT",
        409,
      );
    return row;
  }
  private insertTask(p: string, t: Task) {
    this.db.run(
      "INSERT INTO tasks(project_id,id,kind,title,objective,episode,shot,enabled,review_enabled) VALUES(?,?,?,?,?,?,?,?,?)",
      p,
      t.id,
      t.kind,
      t.title,
      t.objective,
      t.episode ?? null,
      t.shot ?? null,
      +t.enabled,
      +t.reviewEnabled,
    );
  }
  private insertDependencies(p: string, tasks: Task[]) {
    for (const t of tasks)
      for (const d of t.dependencies)
        this.db.run("INSERT INTO dependencies VALUES(?,?,?)", p, t.id, d);
  }
  create(
    name: string,
    message: string,
    files: StoredUpload[],
    requestId?: string,
  ) {
    const id = randomUUID();
    this.db.transaction(() => {
      this.db.run(
        "INSERT INTO projects(id,name,created_at,representative_episode,representative_shot) VALUES(?,?,?,0,0)",
        id,
        name,
        now(),
      );
      const tasks = Object.values(emptyProject(id, name).tasks);
      tasks.forEach((t) => this.insertTask(id, t));
      this.insertDependencies(id, tasks);
      files.forEach((f) => this.insertFile(id, null, "source", f));
      this.message(id, "你", "human", message);
      if (requestId)
        this.db.run("INSERT INTO import_requests VALUES(?,?)", requestId, id);
    });
    return id;
  }
  message(
    p: string,
    sender: string,
    role: string,
    text: string,
    task?: string,
    request?: string,
    details: {
      audience?: "human" | "agents";
      requiresReply?: boolean;
      replyToId?: string;
    } = {},
  ) {
    let replyTo = details.replyToId;
    if (replyTo)
      ensure(
        this.db.one(
          "SELECT id FROM messages WHERE id=? AND project_id=?",
          replyTo,
          p,
        ),
        "引用消息不属于当前剧本",
      );
    if (role === "human" && !replyTo) {
      const pending = this.db.all<Row>(
        "SELECT m.id FROM messages m JOIN message_details d ON d.message_id=m.id WHERE m.project_id=? AND d.requires_reply=1 AND d.answered_by IS NULL AND NOT EXISTS (SELECT 1 FROM confirmation_skips s WHERE s.message_id=m.id)",
        p,
      );
      // An unquoted reply can resolve one unambiguous question, never a whole batch.
      if (pending.length === 1) replyTo = pending[0].id;
    }
    const audience =
      details.audience ??
      (role === "coordinator" && !/^\s*@/.test(text) ? "human" : "agents");
    ensure(
      !details.requiresReply ||
        (role === "coordinator" && audience === "human"),
      "只有总控可以向用户发起确认",
    );
    const id = randomUUID();
    this.db.run(
      "INSERT INTO messages(id,project_id,sender,role,text,task_id,request_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
      id,
      p,
      sender,
      role,
      text,
      task ?? null,
      request ?? null,
      now(),
    );
    this.db.run(
      "INSERT INTO message_details(message_id,audience,requires_reply,reply_to_id) VALUES(?,?,?,?)",
      id,
      audience,
      +(details.requiresReply ?? false),
      replyTo ?? null,
    );
    if (role === "human" && replyTo && text.trim()) {
      this.db.run(
        "UPDATE message_details SET answered_by=? WHERE message_id=? AND requires_reply=1 AND answered_by IS NULL AND NOT EXISTS (SELECT 1 FROM confirmation_skips s WHERE s.message_id=message_details.message_id)",
        id,
        replyTo,
      );
    }
    this.bump(p);
    return id;
  }
  skipConfirmation(p: string, messageId: string) {
    return this.db.transaction(() => {
      this.check(p);
      const question = this.db.one<Row>(
        "SELECT m.text,d.requires_reply,d.answered_by FROM messages m JOIN message_details d ON d.message_id=m.id WHERE m.id=? AND m.project_id=?",
        messageId,
        p,
      );
      ensure(
        question?.requires_reply,
        "找不到当前剧本的待确认问题",
        "NOT_FOUND",
        404,
      );
      const existing = this.db.one<Row>(
        "SELECT notice_id FROM confirmation_skips WHERE message_id=?",
        messageId,
      );
      if (existing) return existing.notice_id as string;
      ensure(
        !question.answered_by,
        "这个问题已经回复，无需跳过",
        "CONFLICT",
        409,
      );
      const notice = this.message(
        p,
        "系统",
        "system",
        `用户已跳过问题：${question.text}\n\n跳过表示暂不回答，不代表同意建议、确认方案或验收产出。不要重复催问；可以继续不依赖此答案的工作，缺失信息保持未确定。`,
        undefined,
        undefined,
        { audience: "agents", replyToId: messageId },
      );
      this.db.run(
        "INSERT INTO confirmation_skips(message_id,notice_id,created_at) VALUES(?,?,?)",
        messageId,
        notice,
        now(),
      );
      return notice;
    });
  }
  snapshot() {
    const projects = this.db
      .all<Row>("SELECT id FROM projects ORDER BY created_at")
      .map((r) => this.project(r.id));
    const files: Record<string, MediaFile[]> = {};
    for (const p of projects) {
      const source = this.db.all<Row>(
        "SELECT * FROM files WHERE project_id=? AND scope='source' ORDER BY rowid",
        p.id,
      );
      files[`${p.id}/sources`] = source.map((f) => this.fileView(f));
      files[`${p.id}/exports`] = this.db
        .all<Row>(
          "SELECT * FROM files WHERE project_id=? AND scope='export' ORDER BY created_at DESC, rowid DESC",
          p.id,
        )
        .map((f) => this.fileView(f));
      const attached = this.db.all<Row>(
        "SELECT f.* FROM output_files o JOIN files f ON f.id=o.file_id WHERE o.project_id=? AND NOT EXISTS (SELECT 1 FROM image_trash b WHERE b.file_id=f.id) AND o.revision=(SELECT MAX(x.revision) FROM outputs x WHERE x.project_id=o.project_id AND x.task_id=o.task_id)",
        p.id,
      );
      for (const f of attached)
        (files[`${p.id}/${f.task_id}`] ??= []).push(this.fileView(f));
    }
    return {
      state: { schema: 1 as const, activeId: projects[0]?.id ?? "", projects },
      files,
    };
  }
  private fileView(f: Row): MediaFile {
    return {
      ...storedDimensions(this.db, f.id),
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.mime,
      url: `/api/files/${f.id}`,
    };
  }
  outputFiles(p: string, t: string, r: number) {
    return this.db.all<Row>(
      "SELECT f.*,m.width,m.height FROM output_files o JOIN files f ON f.id=o.file_id LEFT JOIN image_metadata m ON m.file_id=f.id WHERE o.project_id=? AND o.task_id=? AND o.revision=? AND NOT EXISTS (SELECT 1 FROM image_trash b WHERE b.file_id=f.id)",
      p,
      t,
      r,
    );
  }
  project(p: string): StudioProject {
    const row = this.check(p),
      project = emptyProject(p, row.name);
    project.version = row.version;
    project.imageLibrary = imageInventory(this.db, p);
    project.confirmed = !!row.confirmed;
    project.representativeEpisode = row.representative_episode;
    project.representativeShot = row.representative_shot;
    project.episodes = this.db
      .all<Row>("SELECT * FROM episodes WHERE project_id=? ORDER BY number", p)
      .map((e) => ({
        number: e.number,
        title: e.title,
        synopsis: e.synopsis,
        shots: e.shots,
        representativeShot:
          this.db.one<{ shot: number }>(
            "SELECT shot FROM episode_focus WHERE project_id=? AND episode=?",
            p,
            e.number,
          )?.shot ??
          (e.number === project.representativeEpisode
            ? project.representativeShot
            : 0),
      }));
    const outputs = this.db.all<Row>(
      "SELECT * FROM outputs WHERE project_id=? ORDER BY revision",
      p,
    );
    const reviews = this.db.all<Row>(
      "SELECT * FROM reviews WHERE project_id=? ORDER BY rowid",
      p,
    );
    const dependencies = this.db.all<Row>(
      "SELECT * FROM dependencies WHERE project_id=?",
      p,
    );
    const status = (o: Row): Delivery => {
      const r = reviews
        .filter((r) => r.task_id === o.task_id && r.revision === o.revision)
        .at(-1);
      if (!o.text) return "empty";
      return r?.decision === "return"
        ? "returned"
        : r?.stage === "acceptance" && r.decision === "pass"
          ? "approved"
          : r?.stage === "content" && r.decision === "pass"
            ? "reviewed"
            : "draft";
    };
    project.tasks = {};
    for (const t of this.db.all<Row>(
      "SELECT * FROM tasks WHERE project_id=?",
      p,
    )) {
      const versions = outputs.filter((o) => o.task_id === t.id),
        o = versions.at(-1);
      project.tasks[t.id] = {
        id: t.id,
        kind: t.kind,
        title: t.title,
        objective: t.objective,
        episode: t.episode ?? undefined,
        shot: t.shot ?? undefined,
        enabled: !!t.enabled,
        retirement: (() => {
          const retired = this.db.one<Row>(
            "SELECT reason,actor,retired_at FROM retired_assets WHERE project_id=? AND task_id=?",
            p,
            t.id,
          );
          return retired
            ? {
                reason: retired.reason,
                actor: retired.actor,
                time: retired.retired_at,
              }
            : undefined;
        })(),
        reviewEnabled: !!t.review_enabled,
        placeholder: !!this.db.one(
          "SELECT task_id FROM legacy_scaffolding WHERE project_id=? AND task_id=?",
          p,
          t.id,
        ),
        dependencies: dependencies
          .filter((d) => d.task_id === t.id)
          .map((d) => d.input_id),
        delivery: o ? status(o) : "empty",
        text: o?.text ?? "",
        structure: (() => {
          const row = this.db.one<{ body: string }>(
            "SELECT body FROM output_structures WHERE project_id=? AND task_id=? AND revision=?",
            p,
            t.id,
            o?.revision ?? 0,
          );
          return row ? JSON.parse(row.body) : undefined;
        })(),
        revision: o?.revision ?? 0,
        history: versions.slice(0, -1).map((o) => ({
          text: o.text,
          revision: o.revision,
          delivery: status(o),
        })),
        assetIds: JSON.parse(o?.asset_ids ?? "[]"),
        reuseReason: o?.reuse_reason ?? "",
        assetName: o?.asset_name ?? undefined,
        assetCategory: o?.asset_category ?? undefined,
        imageSpec: (() => {
          const spec = this.db.one<Row>(
            "SELECT purpose,basis_task_id FROM image_task_specs WHERE project_id=? AND task_id=?",
            p,
            t.id,
          );
          return spec
            ? {
                purpose: spec.purpose,
                basisTaskId: spec.basis_task_id ?? undefined,
              }
            : undefined;
        })(),
        rejection: reviews
          .filter(
            (r) =>
              r.task_id === t.id &&
              r.revision === o?.revision &&
              r.decision === "return",
          )
          .at(-1)?.reason,
      };
    }
    project.assets = this.db
      .all<Row>(
        `SELECT a.* FROM assets a WHERE project_id=? AND version=(SELECT MAX(b.version) FROM assets b WHERE b.project_id=a.project_id AND b.id=a.id)
        AND NOT EXISTS (SELECT 1 FROM output_files o JOIN image_trash b ON b.file_id=o.file_id WHERE o.project_id=a.project_id AND o.task_id=a.task_id AND o.revision=a.output_revision)`,
        p,
      )
      .filter(
        (a) =>
          project.tasks[a.task_id]?.delivery === "approved" &&
          project.tasks[a.task_id]?.revision === a.output_revision &&
          !this.pendingFeedback(p, a.task_id).length,
      )
      .map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        status: "approved",
        description: a.description,
        version: a.version,
        sourceIds: JSON.parse(a.source_ids),
        taskId: a.task_id,
        outputRevision: a.output_revision,
        files: this.outputFiles(p, a.task_id, a.output_revision).map((f) =>
          this.fileView(f),
        ),
      }));
    project.messages = this.db
      .all<Row>(
        "SELECT m.*,d.audience,d.requires_reply,d.reply_to_id,d.answered_by,s.created_at AS skipped_at FROM messages m LEFT JOIN message_details d ON d.message_id=m.id LEFT JOIN confirmation_skips s ON s.message_id=m.id WHERE m.project_id=? AND (m.request_id IS NULL OR m.request_id NOT LIKE 'question-handoff-%') AND NOT EXISTS (SELECT 1 FROM confirmation_skips hidden WHERE hidden.notice_id=m.id) ORDER BY m.created_at,m.seq",
        p,
      )
      .map((m) => ({
        id: m.id,
        sender: /^question-[a-f\d-]{36}$/i.test(m.request_id ?? "")
          ? `${project.tasks[m.task_id]?.title ?? "节点问题"} · 转交总控 AI`
          : m.sender,
        text: m.text,
        ...(() => {
          const item = this.db.one<Row>(
            "SELECT run_id,phase FROM ai_message_items WHERE message_id=? ORDER BY CASE WHEN phase='final_answer' THEN 0 ELSE 1 END,seq DESC LIMIT 1",
            m.id,
          );
          return item ? { runId: item.run_id, phase: item.phase } : {};
        })(),
        taskId: m.task_id ?? undefined,
        time: m.created_at,
        audience: /^question-[a-f\d-]{36}$/i.test(m.request_id ?? "")
          ? "agents"
          : (m.audience ??
            (m.role === "coordinator" && !/^\s*@/.test(m.text)
              ? "human"
              : "agents")),
        replyToId: m.reply_to_id ?? undefined,
        references: messageReferences(this.db, m.id),
        attachments: this.messageImages(p, m.id),
        questionTransfer: (() => {
          if (!m.request_id?.startsWith("question-")) return undefined;
          const q = this.db.one<Row>(
            "SELECT q.id,q.status FROM node_questions q JOIN node_jobs j ON j.id=q.job_id WHERE q.id=? AND j.project_id=?",
            m.request_id.slice(9),
            p,
          );
          return q
            ? {
                questionId: q.id,
                status:
                  q.status === "answered"
                    ? ("answered" as const)
                    : ("pending" as const),
              }
            : undefined;
        })(),
        feedback: (() => {
          const f = this.db.one<Row>(
            "SELECT status,task_id,revision FROM image_feedback WHERE message_id=?",
            m.id,
          );
          return f
            ? { status: f.status, taskId: f.task_id, revision: f.revision }
            : undefined;
        })(),
        image: (() => {
          const g = this.db.one<Row>(
            "SELECT g.*,f.name AS file_name,f.mime,f.size,EXISTS(SELECT 1 FROM image_trash b WHERE b.file_id=g.file_id) AS trashed FROM image_generations g LEFT JOIN files f ON f.id=g.file_id WHERE g.message_id=?",
            m.id,
          );
          return g
            ? {
                id: g.id,
                status: g.status,
                name: g.name,
                error: g.error ?? undefined,
                revision: g.revision ?? undefined,
                current:
                  !!g.file_id &&
                  !!this.db.one(
                    "SELECT file_id FROM output_files WHERE project_id=? AND task_id=? AND revision=? AND file_id=?",
                    p,
                    g.task_id,
                    project.tasks[g.task_id]?.revision ?? 0,
                    g.file_id,
                  ),
                delivery: project.tasks[g.task_id]?.delivery,
                file: g.file_id
                  ? {
                      ...storedDimensions(this.db, g.file_id),
                      id: g.file_id,
                      trashed: !!g.trashed,
                      name: g.file_name,
                      type: g.mime,
                      size: g.size,
                      url: `/api/files/${g.file_id}`,
                    }
                  : undefined,
              }
            : undefined;
        })(),
        execution: (() => {
          const job = this.db.one<Row>(
            "SELECT status,error FROM node_jobs WHERE message_id=?",
            m.id,
          );
          return job
            ? { status: job.status, error: job.error ?? undefined }
            : undefined;
        })(),
        confirmation: m.requires_reply
          ? {
              status: m.skipped_at
                ? ("skipped" as const)
                : m.answered_by
                  ? ("answered" as const)
                  : ("pending" as const),
              answeredBy: m.answered_by ?? undefined,
              skippedAt: m.skipped_at ?? undefined,
            }
          : undefined,
      }));
    project.events = this.db
      .all<Row>("SELECT * FROM events WHERE project_id=? ORDER BY rowid", p)
      .map((e) => ({
        id: e.id,
        taskId: e.task_id,
        action: e.action,
        revision: e.revision,
        text: e.text,
        time: e.created_at,
      }));
    project.sources = this.db
      .all<Row>(
        "SELECT * FROM files WHERE project_id=? AND scope='source' ORDER BY rowid",
        p,
      )
      .map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.mime }));
    const plan = this.db.one<Row>(
      "SELECT * FROM plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1",
      p,
    );
    if (plan)
      project.plan = {
        ...JSON.parse(plan.body),
        id: plan.id,
        confirmed: !!plan.confirmed_by,
      };
    const run = this.db.one<Row>(
      "SELECT * FROM runs WHERE project_id=? AND parent_id IS NULL ORDER BY rowid DESC LIMIT 1",
      p,
    );
    if (run)
      project.run = {
        id: run.id,
        status: run.status,
        error: run.error ?? undefined,
        progress: ["queued", "running"].includes(run.status)
          ? (() => {
              const latest = this.db.one<Row>(
                `WITH RECURSIVE chain(id) AS (
                  SELECT id FROM runs WHERE id=?
                  UNION ALL SELECT r.id FROM runs r JOIN chain c ON r.parent_id=c.id
                ) SELECT i.phase,i.text FROM ai_message_items i
                JOIN runs r ON r.id=i.run_id JOIN sessions s ON s.id=r.session_id
                WHERE r.id IN (SELECT id FROM chain) AND s.role='coordinator'
                ORDER BY i.seq DESC LIMIT 1`,
                run.id,
              );
              return latest?.phase === "commentary" ? latest.text : undefined;
            })()
          : undefined,
      };
    project.sessions = this.db
      .all<Row>("SELECT * FROM sessions WHERE project_id=?", p)
      .map((s) => ({
        role: s.role,
        scope: s.scope,
        threadId: s.thread_id ?? undefined,
      }));
    return project;
  }
  /** Only reviewed derivative image tasks may finish under the asset reviewer's authority. */
  canAcceptReviewedImage(p: string, t: string) {
    const project = this.project(p),
      task = project.tasks[t];
    if (
      !task?.enabled ||
      !task.reviewEnabled ||
      task.kind !== "assets" ||
      task.delivery !== "reviewed"
    )
      return false;
    const spec = this.db.one<Row>(
      "SELECT * FROM image_task_specs WHERE project_id=? AND task_id=?",
      p,
      t,
    );
    if (
      !spec?.basis_task_id ||
      ![
        "角色基础图",
        "角色三视图",
        "面部特写",
        "局部特写",
        "服装图",
        "动作参考",
        "穿衣组合",
      ].includes(spec.purpose)
    )
      return false;
    const basis = project.tasks[spec.basis_task_id];
    if (
      basis?.delivery !== "approved" ||
      !basis.enabled ||
      basis.assetCategory !== "人物"
    )
      return false;
    const basisSpec = this.db.one<Row>(
      "SELECT purpose FROM image_task_specs WHERE project_id=? AND task_id=?",
      p,
      basis.id,
    );
    if (basisSpec && !isCharacterBasis(basisSpec.purpose)) return false;
    const acceptance = this.db.one<Row>(
      "SELECT actor FROM reviews WHERE project_id=? AND task_id=? AND revision=? AND stage='acceptance' AND decision='pass' ORDER BY rowid DESC LIMIT 1",
      p,
      basis.id,
      basis.revision,
    );
    if (!acceptance || !["coordinator", "human"].includes(acceptance.actor))
      return false;
    if (
      task.dependencies.some((id) => project.tasks[id]?.delivery !== "approved")
    )
      return false;
    if (
      !this.outputFiles(p, t, task.revision).some((f) =>
        f.mime.startsWith("image/"),
      ) ||
      !this.outputFiles(p, basis.id, basis.revision).some((f) =>
        f.mime.startsWith("image/"),
      )
    )
      return false;
    const review = this.db.one<Row>(
      "SELECT actor FROM reviews WHERE project_id=? AND task_id=? AND revision=? AND stage='content' AND decision='pass' ORDER BY rowid DESC LIMIT 1",
      p,
      t,
      task.revision,
    );
    return (
      review?.actor === "reviewer" &&
      !this.db.one(
        "SELECT q.id FROM node_questions q JOIN node_jobs j ON j.id=q.job_id WHERE j.project_id=? AND j.task_id=? AND q.status IN ('pending','escalated')",
        p,
        t,
      )
    );
  }
  acceptReviewedImage(p: string, t: string, revision: number) {
    if (!this.canAcceptReviewedImage(p, t)) return false;
    this.act(
      p,
      t,
      { type: "accept" },
      { role: "reviewer", taskId: t },
      revision,
      "资产审核 AI 已审核本版本实际图片；符合已验收首样基准，由系统按补充图授权规则完成验收。无需总控逐张重复验收。",
    );
    return true;
  }
  act(
    p: string,
    t: string,
    action: TaskAction,
    actor: Actor,
    expectedRevision: number,
    reason = "",
    version?: number,
    uploads: StoredUpload[] = [],
    replaceImages = false,
    humanMessageId?: string,
  ) {
    return this.db.transaction(() => {
      this.check(p, version);
      const project = this.project(p),
        current = project.tasks[t];
      ensure(current, "找不到任务");
      const userDirected =
        !!humanMessageId &&
        !!this.db.one(
          "SELECT id FROM messages WHERE id=? AND project_id=? AND role='human'",
          humanMessageId,
          p,
        );
      if (humanMessageId)
        ensure(
          userDirected && actor.role === "coordinator",
          "必须引用当前剧本真实用户意见，由总控处理",
        );
      if (action.type === "return" && userDirected)
        this.db.run(
          "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          t,
          "user-return",
          current.revision,
          "coordinator",
          `根据用户消息 ${humanMessageId} 重新修整：${action.reason}`,
          now(),
        );
      if (action.type === "return" && current.delivery === "approved") {
        ensure(
          actor.role === "human" ||
            (actor.role === "coordinator" && userDirected),
          "已验收产出退回须由用户操作，或由总控引用 humanMessageId 说明用户意见",
        );
      }
      if (["review", "accept", "request-review"].includes(action.type))
        ensure(
          !this.pendingFeedback(p, t).length,
          "存在待总控处理的用户图片意见，暂缓制作与验收，请先处理意见",
          "USER_FEEDBACK",
          409,
        );
      if (["review", "accept"].includes(action.type))
        ensure(
          current.assetIds.every((id) =>
            project.assets.some((a) => a.id === id),
          ),
          "引用资产已退回或不可用，请先修正依赖",
        );
      ensure(
        !current.retirement,
        "此资产已清理，请由总控先恢复任务；恢复不会自动验收或启动制作",
        "CONFLICT",
        409,
      );
      if (action.type === "attach") {
        ensure(uploads.length > 0, "请先上传真实文件");
        const prefix = ["video", "assembly"].includes(current.kind)
          ? "video/"
          : "image/";
        ensure(
          uploads.every((file) => file.mime.startsWith(prefix)),
          "附件类型与当前制作节点不符",
        );
      }
      ensure(
        !current.placeholder,
        "这是旧方案的空占位，需由对应制作阶段的正式产出填充后才能执行",
      );
      ensure(
        current.revision === expectedRevision,
        "产出版本已变化，请重新审核当前版本",
        "CONFLICT",
        409,
      );
      if (actor.role === "coordinator" && action.type === "save")
        ensure(
          current.kind === "brief",
          "总控只能写制作需求，专业产出交给对应节点 AI",
          "FORBIDDEN",
          403,
        );
      if (actor.role === "reviewer")
        ensure(
          current.reviewEnabled &&
            (action.type === "accept"
              ? this.canAcceptReviewedImage(p, t)
              : current.delivery === "draft"),
          "只能审核当前启用的待审核版本",
        );
      if (actor.role === "coordinator" && action.type === "return")
        ensure(
          userDirected ||
            current.delivery === "reviewed" ||
            !current.reviewEnabled ||
            ["video", "assembly"].includes(current.kind),
          "请先让节点内部审核完成",
        );
      if (action.type === "save" && action.structure) {
        structureSchema.parse(action.structure);
        if (current.kind === "script")
          ensure(this.project(p).confirmed, "请先确认流程骨架");
        ensure(
          actor.role === "executor" || actor.role === "human",
          "只有节点制作方可以提交拆分结构",
        );
        ensure(
          (current.kind === "script" && action.structure.kind === "episodes") ||
            (current.kind === "storyboard" &&
              action.structure.kind === "shots"),
          "编剧只拆剧集，分镜只拆本集镜头",
        );
      }
      const control = [
        "accept",
        "toggle-review",
        "toggle-executor",
        "request-review",
      ];
      if (action.type === "request-review")
        ensure(
          !this.db.one(
            "SELECT id FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('working','reviewing','revising','continuing','waiting')",
            p,
            t,
          ),
          "节点仍在执行或等待答复，请先处理当前交接",
        );
      if (actor.role === "executor")
        ensure(
          actor.taskId === t && action.type === "save",
          "制作 AI 只能提交被指派任务的产出",
          "FORBIDDEN",
          403,
        );
      if (actor.role === "reviewer")
        ensure(
          actor.taskId === t &&
            ["review", "return", "accept"].includes(action.type),
          "审核 AI 只能审核被指派任务",
          "FORBIDDEN",
          403,
        );
      if (control.includes(action.type))
        ensure(
          ["human", "coordinator"].includes(actor.role) ||
            (action.type === "accept" &&
              actor.role === "reviewer" &&
              this.canAcceptReviewedImage(p, t)),
          "此操作由总控决定",
          "FORBIDDEN",
          403,
        );
      if (action.type === "review")
        ensure(
          ["human", "reviewer"].includes(actor.role),
          "内容审核必须由独立审核者完成",
          "FORBIDDEN",
          403,
        );
      if (["accept", "review", "return"].includes(action.type))
        ensure(reason.trim() || action.type === "return", "请记录审核理由");
      const present = this.outputFiles(p, t, current.revision);
      if (
        ["review", "accept"].includes(action.type) &&
        (current.kind === "frames" ||
          (current.kind === "assets" &&
            !current.imageSpec &&
            !present.some((f) => f.mime.startsWith("image/"))))
      )
        requireCharacterKits(this, p, t);
      if (action.type === "accept" && current.kind === "assets")
        ensure(
          present.some((f) => f.mime.startsWith("image/")) ||
            current.assetIds.length,
          "请先上传新建资产图片或引用已通过资产",
        );
      const checked =
        action.type === "accept"
          ? {
              type: "accept" as const,
              mediaPresent: present.some((f) => f.mime.startsWith("video/")),
              imagesPresent: present.some((f) => f.mime.startsWith("image/")),
            }
          : action;
      const next = changeTask(project, t, checked),
        task = next.tasks[t];
      if (task.revision !== current.revision) {
        this.db.run(
          "INSERT INTO outputs VALUES(?,?,?,?,?,?,?,?,?,?)",
          p,
          t,
          task.revision,
          task.text,
          JSON.stringify(task.assetIds),
          task.reuseReason,
          task.assetName ?? null,
          task.assetCategory ?? null,
          actor.role,
          now(),
        );
        for (const f of present.filter(
          (f) => !replaceImages || !f.mime.startsWith("image/"),
        ))
          this.db.run(
            "INSERT INTO output_files VALUES(?,?,?,?)",
            p,
            t,
            task.revision,
            f.id,
          );
        for (const f of uploads) {
          this.insertFile(p, t, "output", f);
          this.db.run(
            "INSERT INTO output_files VALUES(?,?,?,?)",
            p,
            t,
            task.revision,
            f.id,
          );
        }
      }
      if (action.type === "save" && action.structure)
        this.db.run(
          "INSERT INTO output_structures VALUES(?,?,?,?)",
          p,
          t,
          task.revision,
          JSON.stringify(action.structure),
        );
      if (
        action.type === "accept" &&
        ["script", "storyboard"].includes(task.kind)
      ) {
        ensure(
          this.db.one(
            "SELECT body FROM output_structures WHERE project_id=? AND task_id=? AND revision=?",
            p,
            t,
            task.revision,
          ),
          "请由对应制作 AI 提交本版本的分集/分镜结构，再审核验收",
        );
        expandAccepted(this.db, project, task);
      }
      if (action.type === "accept" && !task.reviewEnabled)
        this.db.run(
          "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          t,
          "review-skipped",
          task.revision,
          "system",
          "本节点审核已禁用，跳过内部审核；仍由总控验收。",
          now(),
        );
      this.db.run(
        "UPDATE tasks SET enabled=?,review_enabled=? WHERE project_id=? AND id=?",
        +task.enabled,
        +task.reviewEnabled,
        p,
        t,
      );
      if (
        ["review", "accept", "return", "request-review"].includes(action.type)
      )
        this.db.run(
          "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          t,
          task.revision,
          action.type === "review" ||
            (actor.role === "reviewer" && action.type !== "accept")
            ? "content"
            : "acceptance",
          action.type === "request-review"
            ? "reopen"
            : action.type === "return"
              ? "return"
              : "pass",
          actor.role,
          action.type === "return" || action.type === "request-review"
            ? action.reason
            : reason,
          now(),
        );
      const event = next.events.at(-1)!;
      this.db.run(
        "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
        event.id,
        p,
        t,
        action.type,
        task.revision,
        actor.role,
        `${names[actor.role]}：${actor.role === "reviewer" && action.type === "accept" ? `${task.title}：依据已验收首样完成补充图验收，产出 v${task.revision} 可供后续引用。` : event.text.replaceAll("演示", "")}${reason ? `\n依据：${reason}` : ""}`,
        event.time,
      );
      for (const a of next.assets.filter(
        (a) =>
          !project.assets.some(
            (old) => old.id === a.id && old.version === a.version,
          ),
      ))
        this.db.run(
          "INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?)",
          p,
          a.id,
          a.version,
          a.name,
          a.category,
          a.description,
          JSON.stringify(a.sourceIds),
          t,
          task.revision,
        );
      if (
        action.type === "accept" ||
        (action.type === "return" && actor.role !== "reviewer")
      )
        this.db.run(
          "UPDATE node_jobs SET status=?,updated_at=? WHERE project_id=? AND task_id=? AND status='submitted'",
          action.type === "accept" ? "completed" : "returned",
          now(),
          p,
          t,
        );
      this.bump(p);
      return task;
    });
  }
  private insertFile(
    p: string,
    t: string | null,
    scope: string,
    f: StoredUpload,
  ) {
    this.db.run(
      "INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?)",
      f.id,
      p,
      t,
      f.name,
      f.mime,
      f.size,
      f.hash,
      scope,
      now(),
    );
    if (f.width && f.height)
      saveDimensions(this.db, f.id, { width: f.width, height: f.height });
  }
  propose(p: string, plan: Plan) {
    return this.db.transaction(() => {
      plan = planSchema.parse(plan);
      const project = this.project(p);
      ensure(!project.confirmed, "流程已确认，暂不支持覆盖已有制作流程");
      ensure(
        project.tasks.brief.delivery === "approved",
        "请先确认并验收制作需求",
      );
      const latest = this.db.one<Row>(
        "SELECT * FROM plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1",
        p,
      );
      if (latest && latest.body === JSON.stringify(plan))
        return {
          id: latest.id as string,
          ...this.planConfirmation(p, latest.id),
        };
      const id = randomUUID();
      const message = this.message(
        p,
        "总控 AI",
        "coordinator",
        `流程方案（待确认）\n\n${plan.summary}\n\n原作理解 → 制作需求 → 整体剧本 → 按产出逐步展开 → 归档。分集由编剧确定，镜头由分镜阶段确定。`,
        undefined,
        undefined,
        { audience: "human", requiresReply: true },
      );
      this.db.run(
        "INSERT INTO plans VALUES(?,?,?,?,?,?)",
        id,
        p,
        JSON.stringify(plan),
        message,
        null,
        now(),
      );
      return {
        id,
        messageId: message,
        awaitingConfirmation: true,
        notice:
          "流程方案已生成待确认消息，等待用户回复或点击确认；不要再调用 ask_user 重复询问。",
      };
    });
  }
  planConfirmation(p: string, id: string) {
    const plan = this.db.one<Row>(
      "SELECT p.*,d.answered_by,s.message_id AS skipped FROM plans p JOIN message_details d ON d.message_id=p.message_id LEFT JOIN confirmation_skips s ON s.message_id=p.message_id WHERE p.id=? AND p.project_id=?",
      id,
      p,
    );
    ensure(plan, "找不到当前剧本的流程方案");
    ensure(
      this.db.one<Row>(
        "SELECT id FROM plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1",
        p,
      )?.id === id,
      "请使用最新流程方案",
    );
    return {
      messageId: plan.message_id as string,
      awaitingConfirmation:
        !plan.confirmed_by && !plan.skipped && !plan.answered_by,
      status: plan.confirmed_by
        ? "confirmed"
        : plan.skipped
          ? "skipped"
          : plan.answered_by
            ? "answered"
            : "pending",
      notice:
        "沿用已有流程方案确认，未新增询问。若有其他未解决的问题，先澄清再更新方案，不要把重复询问当作新的确认事项。",
    };
  }
  confirmPlan(p: string, id: string, humanMessage?: string) {
    this.db.transaction(() => {
      const project = this.project(p);
      ensure(!project.confirmed, "流程已经确认");
      const plan = this.db.one<Row>(
        "SELECT * FROM plans WHERE id=? AND project_id=?",
        id,
        p,
      );
      ensure(plan, "找不到方案");
      ensure(
        this.db.one<Row>(
          "SELECT id FROM plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1",
          p,
        )?.id === id,
        "只能确认最新方案",
      );
      humanMessage ??= this.message(
        p,
        "你",
        "human",
        "确认当前流程方案，按此方案推进。",
        undefined,
        undefined,
        { replyToId: plan.message_id },
      );
      const human = this.db.one<Row>(
        "SELECT * FROM messages WHERE id=? AND project_id=? AND role='human'",
        humanMessage,
        p,
      );
      const proposal = this.db.one<Row>(
        "SELECT seq FROM messages WHERE id=?",
        plan.message_id,
      )!;
      ensure(human && human.seq > proposal.seq, "需要用户在方案发布后明确确认");
      // The accepted human response may have been sent without quoting the proposal.
      // Resolve only this proposal; unrelated pending questions must stay pending.
      this.db.run(
        "UPDATE message_details SET answered_by=? WHERE message_id=? AND requires_reply=1 AND answered_by IS NULL AND NOT EXISTS(SELECT 1 FROM confirmation_skips s WHERE s.message_id=message_details.message_id)",
        humanMessage,
        plan.message_id,
      );
      this.db.run(
        "UPDATE projects SET confirmed=1,representative_episode=0,representative_shot=0,version=version+1 WHERE id=?",
        p,
      );
      this.db.run(
        "UPDATE plans SET confirmed_by=? WHERE id=?",
        humanMessage,
        id,
      );
    });
  }
}
export type StoredUpload = {
  width?: number;
  height?: number;
  id: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
};
