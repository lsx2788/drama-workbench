import { randomUUID } from "node:crypto";
import type { Actor } from "../contracts";
import type { StudioService } from "../studio-service";
import { ensure } from "../errors";
import { executorNames, missingInputs } from "../../domain/queries";
import {
  delegationForTask,
  resolveTaskReferences,
  type ReferenceRequest,
} from "./task-references";

type Row = Record<string, any>;
export type NodeTurn = (
  actor: Actor,
  instruction: string,
  sender: string,
) => Promise<string>;

/** A scheduling boundary, never an AI failure or a review decision. */
export class NodeBatchYield extends Error {
  constructor(readonly role: Actor["role"]) {
    super("自动切换执行批次");
  }
}

/** System owns routing; content decisions belong to the task's independent reviewer. */
export class NodePipeline {
  constructor(readonly service: StudioService) {}
  start(
    p: string,
    taskId: string,
    instructions: string,
    parent: string,
    publicInstructions = instructions,
    references?: ReferenceRequest[],
  ) {
    return this.service.db.transaction(() => {
      const inherited =
        delegationForTask(this.service.db, p, taskId)?.references ?? [];
      const refs = resolveTaskReferences(
        this.service.db,
        p,
        references ??
          inherited.map((r) => ({
            fileId: r.file.id!,
            purpose: r.purpose,
            offset: r.offset,
            limit: r.limit,
          })),
      );
      const { jobId, messageId } = this.create(
        p,
        taskId,
        publicInstructions,
        parent,
      );
      this.service.db.run(
        "INSERT INTO node_delegations VALUES(?,?,?,?,?,?,?,?)",
        randomUUID(),
        jobId,
        p,
        taskId,
        messageId,
        instructions,
        JSON.stringify(refs),
        new Date().toISOString(),
      );
      return jobId;
    });
  }
  private create(
    p: string,
    taskId: string,
    instructions: string,
    parent: string,
  ) {
    const task = this.service.project(p).tasks[taskId];
    ensure(task && task.enabled && !task.placeholder, "任务不存在或已暂停");
    ensure(
      !this.retryLimitReached(p, taskId, parent),
      "该节点已连续退回4次，本轮暂停自动返修。请说明阻塞原因，等待调整要求后再继续，不能重复委派绕过限制。",
    );
    ensure(
      !missingInputs(this.service.project(p), task).length,
      "必要前置产出尚未验收",
    );
    ensure(
      !["brief", "video", "assembly"].includes(task.kind),
      "制作需求由总控处理，视频由人工处理",
    );
    ensure(
      task.delivery !== "approved" ||
        ["source", "script", "storyboard"].includes(task.kind),
      "产出已验收，无需重复执行",
    );
    const activeJob = this.service.db.one<Row>(
      "SELECT id FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('working','reviewing','revising','waiting','continuing')",
      p,
      taskId,
    );
    if (activeJob) {
      const question = this.service.db.one<Row>(
        "SELECT id FROM node_questions WHERE job_id=? AND status='escalated' ORDER BY rowid DESC LIMIT 1",
        activeJob.id,
      );
      ensure(
        false,
        question
          ? `该节点等待总控答复问题 ${question.id}，请调用 answer_question 回传答复，无需重复委派。`
          : `该节点正在执行（任务 ${activeJob.id}）。请查询 project 查看进度，等待当前执行结束，不要重复委派。`,
      );
    }
    const resumable = this.service.db.one<Row>(
      "SELECT * FROM node_jobs WHERE project_id=? AND task_id=? AND status IN ('paused','failed') ORDER BY rowid DESC LIMIT 1",
      p,
      taskId,
    );
    const messageId = this.service.message(
      p,
      "总控 AI",
      "coordinator",
      `@${executorNames[task.kind]} ${instructions}`,
      taskId,
      undefined,
      { audience: "agents" },
    );
    if (resumable) {
      this.service.db.run(
        "UPDATE node_jobs SET parent_run=? WHERE id=?",
        parent,
        resumable.id,
      );
      this.set(resumable.id, "working");
      return { jobId: resumable.id as string, messageId };
    }
    const id = randomUUID();
    const message = this.service.message(
      p,
      executorNames[task.kind],
      "executor",
      "任务已交接，正在处理。",
      taskId,
      undefined,
      { audience: "agents" },
    );
    this.service.db.run(
      "INSERT INTO node_jobs VALUES(?,?,?,?,?,?,?,?)",
      id,
      p,
      taskId,
      message,
      parent,
      "working",
      null,
      new Date().toISOString(),
    );
    return { jobId: id, messageId };
  }
  set(id: string, status: string, error?: string) {
    this.service.db.run(
      "UPDATE node_jobs SET status=?,error=?,updated_at=? WHERE id=?",
      status,
      error ?? null,
      new Date().toISOString(),
      id,
    );
  }
  question(p: string, jobId: string, actor: Actor, text: string) {
    const job = this.job(p, jobId);
    ensure(
      actor.role === "executor" && actor.taskId === job.task_id,
      "只能提出当前制作节点的问题",
    );
    ensure(!this.pending(jobId), "已有问题等待处理，请先等待答复");
    const id = randomUUID();
    this.service.db.run(
      "INSERT INTO node_questions VALUES(?,?,?,?,?,?,?)",
      id,
      jobId,
      text,
      "pending",
      null,
      null,
      new Date().toISOString(),
    );
    return {
      questionId: id,
      status: "等待节点审核判断，结束本轮后系统自动转交",
    };
  }
  decide(
    p: string,
    jobId: string,
    actor: Actor,
    questionId: string,
    escalate: boolean,
    reason: string,
  ) {
    const job = this.job(p, jobId),
      q = this.pending(jobId);
    ensure(
      actor.role === "reviewer" && actor.taskId === job.task_id,
      "只有本节点审核 AI 可以判断是否上报",
    );
    ensure(
      q?.id === questionId && q.status === "pending",
      "问题已处理或不属于此节点",
    );
    this.service.db.run(
      "UPDATE node_questions SET status=?,reason=? WHERE id=?",
      escalate ? "escalated" : "declined",
      reason,
      questionId,
    );
    return { status: escalate ? "系统将转总控" : "系统将原因交回制作 AI" };
  }
  answer(
    p: string,
    questionId: string,
    answer: string,
    parent: string,
    reviewExisting = false,
    pause = false,
  ) {
    return this.service.db.transaction(() => {
      const q = this.service.db.one<Row>(
        "SELECT q.*,j.task_id,j.project_id FROM node_questions q JOIN node_jobs j ON j.id=q.job_id WHERE q.id=? AND j.project_id=?",
        questionId,
        p,
      );
      ensure(q && q.status === "escalated", "只能回答当前等待总控答复的问题");
      ensure(!(pause && reviewExisting), "暂停节点不能同时重新送审");
      ensure(
        this.service.project(p).tasks[q.task_id]?.enabled,
        "该任务已暂停，请先恢复",
      );
      this.service.db.run(
        "UPDATE node_questions SET status='answered',answer=? WHERE id=?",
        answer,
        questionId,
      );
      this.service.db.run(
        "UPDATE node_jobs SET parent_run=? WHERE id=?",
        parent,
        q.job_id,
      );
      if (pause) {
        this.set(q.job_id, "paused", answer);
        this.service.db.run(
          "INSERT INTO events VALUES(?,?,?,?,?,?,?,?)",
          randomUUID(),
          p,
          q.task_id,
          "pause-after-answer",
          this.service.project(p).tasks[q.task_id].revision,
          "coordinator",
          answer,
          new Date().toISOString(),
        );
        return { jobId: q.job_id, paused: true, instruction: answer };
      }
      if (reviewExisting) {
        ensure(
          this.job(p, q.job_id).status === "waiting",
          "请等待节点问题完成上报再重新送审",
        );
        const task = this.service.project(p).tasks[q.task_id];
        if (task.delivery === "returned") {
          this.set(q.job_id, "paused");
          this.service.act(
            p,
            q.task_id,
            { type: "request-review", reason: answer },
            { role: "coordinator" },
            task.revision,
            answer,
          );
        }
        ensure(
          this.service.project(p).tasks[q.task_id].delivery === "draft",
          "当前产出无需重新独立审核",
        );
      }
      return {
        jobId: q.job_id,
        paused: false,
        instruction: reviewExisting
          ? `仅对原版本重新独立审核，不运行制作或保存新版。总控补充依据：${answer}`
          : `问题：${q.question}\n总控答复：${answer}\n请据此继续原任务。`,
      };
    });
  }
  pending(jobId: string) {
    return this.service.db.one<Row>(
      "SELECT * FROM node_questions WHERE job_id=? AND status IN ('pending','escalated') ORDER BY rowid DESC LIMIT 1",
      jobId,
    );
  }
  job(p: string, id: string) {
    const job = this.service.db.one<Row>(
      "SELECT * FROM node_jobs WHERE id=? AND project_id=?",
      id,
      p,
    );
    ensure(job, "找不到当前节点执行");
    return job;
  }
  private retryLimitReached(p: string, taskId: string, parent: string) {
    const db = this.service.db;
    const root = db.one<Row>(
      `WITH RECURSIVE chain AS (
        SELECT id,parent_id,started_at FROM runs WHERE id=?
        UNION ALL SELECT r.id,r.parent_id,r.started_at FROM runs r JOIN chain c ON r.id=c.parent_id
      ) SELECT started_at FROM chain WHERE parent_id IS NULL`,
      parent,
    );
    if (!root) return false;
    const count = db.one<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM reviews r WHERE project_id=? AND task_id=? AND decision='return' AND created_at>=?
          AND NOT EXISTS (SELECT 1 FROM image_feedback f
            WHERE f.project_id=r.project_id AND f.task_id=r.task_id
              AND f.status='revise' AND f.resolution=r.reason AND r.actor='coordinator'))
        + (SELECT COUNT(*) FROM node_questions q JOIN node_jobs j ON j.id=q.job_id
           WHERE j.project_id=? AND j.task_id=? AND q.status='declined' AND q.created_at>=?) AS n`,
      p,
      taskId,
      root.started_at,
      p,
      taskId,
      root.started_at,
    )!.n;
    return count >= 4;
  }
  async drive(
    p: string,
    id: string,
    instruction: string,
    turn: NodeTurn,
    produce = false,
  ) {
    const job = this.job(p, id),
      taskId = job.task_id;
    const task = () => this.service.project(p).tasks[taskId];
    const result = (status: string, extra: object = {}) => ({
      status,
      taskId,
      revision: task().revision,
      ...extra,
    });
    const userFeedback = () => {
      const feedback = this.service.pendingFeedback(p, taskId);
      if (!feedback.length) return undefined;
      this.set(id, "paused", "用户已提出图片指导意见，等待总控转达；暂缓验收");
      return result("user_feedback", {
        feedback,
        instruction:
          "总控先核对并用 resolve_image_feedback 处理用户意见，再委派原节点修整或继续审核。",
      });
    };
    const checkpoint =
      job.status === "continuing"
        ? this.service.db.one<Row>(
            "SELECT * FROM node_checkpoints WHERE job_id=? AND status='queued'",
            id,
          )
        : undefined;
    let next = checkpoint?.instruction ?? instruction,
      from = checkpoint?.sender ?? "总控 AI",
      round = checkpoint?.round ?? 0;
    if (checkpoint)
      this.service.db.run(
        "UPDATE node_checkpoints SET status='resumed',updated_at=? WHERE job_id=?",
        new Date().toISOString(),
        id,
      );
    try {
      // Bound automatic correction without approving or dropping work at the limit.
      for (; round < 4; round++) {
        let productionRevision: number | undefined;
        const before = userFeedback();
        if (before) return before;
        if (this.retryLimitReached(p, taskId, job.parent_run)) break;
        if (!task().enabled) {
          this.set(id, "paused", "制作节点已禁用，等待恢复");
          return result("paused", { reason: "制作节点已禁用" });
        }
        ensure(
          !missingInputs(this.service.project(p), task()).length,
          "必要前置产出尚未验收，暂不能继续",
        );
        if (
          !(checkpoint?.role === "reviewer" && round === checkpoint.round) &&
          !this.pending(id) &&
          ((produce && round === 0) ||
            (checkpoint?.role === "executor" && round === checkpoint.round) ||
            !["draft", "reviewed"].includes(task().delivery) ||
            next.startsWith("问题："))
        ) {
          this.set(id, round ? "revising" : "working");
          productionRevision = task().revision;
          await turn({ role: "executor", taskId }, next, from);
        }
        const afterProduction = userFeedback();
        if (afterProduction) return afterProduction;
        if (!task().enabled) {
          this.set(id, "paused");
          return result("paused");
        }
        let q = this.pending(id);
        if (q) {
          if (q.status === "pending" && task().reviewEnabled) {
            this.set(id, "reviewing");
            await turn(
              { role: "reviewer", taskId },
              `请判断制作方问题是否需要转总控，调用 review_question，不要审核产出或自行回答用户。问题编号：${q.id}\n问题：${q.question}`,
              executorNames[task().kind],
            );
            q = this.service.db.one<Row>(
              "SELECT * FROM node_questions WHERE id=?",
              q.id,
            )!;
          } else if (q.status === "pending") {
            this.service.db.run(
              "UPDATE node_questions SET status='escalated',reason='节点审核已禁用，系统直接上报' WHERE id=?",
              q.id,
            );
            q = { ...q, status: "escalated" };
          }
          if (q.status === "escalated") {
            this.set(id, "waiting");
            if (
              !this.service.db.one(
                "SELECT id FROM messages WHERE project_id=? AND request_id=?",
                p,
                `question-${q.id}`,
              )
            )
              this.service.message(
                p,
                `${task().title} · 转交总控 AI`,
                "system",
                q.question,
                taskId,
                `question-${q.id}`,
                { audience: "agents" },
              );
            return result("waiting", {
              questionId: q.id,
              question: q.question,
              reason: q.reason,
            });
          }
          ensure(q.status === "declined", "审核 AI 尚未提交是否上报的决定");
          next = `问题：${q.question}\n节点审核认为无需上报：${q.reason}\n请继续原任务；仍需澄清可提出具体新问题。`;
          from = `${task().title} · 审核 AI`;
          continue;
        }
        // A declined escalation may simply return an existing draft for its
        // first content review. That is not a failed revision attempt. Returned
        // outputs and coordinator-requested changes still need a new version.
        const existingDraftForReview =
          task().reviewEnabled &&
          task().delivery === "draft" &&
          from === `${task().title} · 审核 AI` &&
          next.startsWith("问题：");
        if (
          productionRevision !== undefined &&
          task().revision === productionRevision &&
          !existingDraftForReview
        ) {
          const reason =
            "制作未保存新版产出，已暂停自动重试。请总控核对本轮工具结果和制作说明，处理阻塞后再继续；这不是新一轮内容审核退回。";
          this.set(id, "paused", reason);
          return result("paused", { reason, code: "NO_NEW_OUTPUT" });
        }
        ensure(task().text, "制作 AI 未提交产出或问题，请重新安排任务");
        if (task().reviewEnabled && task().delivery === "draft") {
          this.set(id, "reviewing");
          await turn(
            { role: "reviewer", taskId },
            `请独立审核 ${task().title} v${task().revision}。调用 project 获取当前正文、拆分结构及已验收输入；通过 act 提交 review 或 return，必须写具体理由。`,
            executorNames[task().kind],
          );
        }
        if (task().delivery === "returned") {
          next = `请修改 ${task().title}。节点审核意见：${task().rejection}。修改后重新保存；系统会再次送审。`;
          from = `${task().title} · 审核 AI`;
          continue;
        }
        const afterReview = userFeedback();
        if (afterReview) return afterReview;
        ensure(
          task().delivery === "reviewed" ||
            (!task().reviewEnabled && task().delivery === "draft"),
          "节点审核尚未完成，不能交付总控",
        );
        const accepted = this.service.db.transaction(() => {
          if (!this.service.acceptReviewedImage(p, taskId, task().revision))
            return false;
          this.set(id, "completed");
          this.service.db.run(
            "UPDATE messages SET text=? WHERE id=?",
            `${task().title} v${task().revision} 已由资产审核 AI 验收，可使用。沿用已通过首样基准。`,
            job.message_id,
          );
          return true;
        });
        if (accepted) {
          return result("completed", {
            delivery: task().delivery,
            acceptance: "asset-reviewer",
          });
        }
        this.set(id, "submitted");
        this.service.db.run(
          "UPDATE messages SET text=? WHERE id=?",
          `${task().title} v${task().revision} 已提交总控验收。${task().reviewEnabled ? "节点独立审核通过。" : "独立审核已禁用，本次跳过。"}`,
          job.message_id,
        );
        return result("submitted", {
          delivery: task().delivery,
          reviewSkipped: !task().reviewEnabled,
        });
      }
      this.set(
        id,
        "paused",
        "该节点已达到4轮自动复审上限，保留产出与修改意见，等待调整要求后继续。",
      );
      return result("paused", { reason: this.job(p, id).error });
    } catch (e) {
      const feedback = userFeedback();
      if (feedback) return feedback;
      if (e instanceof NodeBatchYield) {
        this.service.db.transaction(() => {
          this.service.db.run(
            `INSERT INTO node_checkpoints VALUES(?,?,?,?,?,'queued',?)
             ON CONFLICT(job_id) DO UPDATE SET instruction=excluded.instruction,sender=excluded.sender,
             round=excluded.round,role=excluded.role,status='queued',updated_at=excluded.updated_at`,
            id,
            next,
            from,
            round,
            e.role,
            new Date().toISOString(),
          );
          this.set(id, "continuing");
        });
        return result("continuing", {
          reason:
            "已保存进度，系统将在当前批次结束后自动续跑，无需用户回复，也不要重复委派。",
        });
      }
      this.set(id, "failed", e instanceof Error ? e.message : "节点执行失败");
      throw e;
    }
  }
}
