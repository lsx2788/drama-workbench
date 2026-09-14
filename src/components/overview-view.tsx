"use client";
import { Clapperboard, ArrowUpRight } from "lucide-react";
import { str, type Workspace, type RecordData } from "@/client/api";
import { Badge, Empty, Panel } from "./ui";
import type { CreateAction } from "./view-types";
export function OverviewView({
  w,
  project,
  create,
  setTab,
}: {
  w: Workspace;
  project?: RecordData;
  create: CreateAction;
  setTab: (tab: string) => void;
}) {
  return (
    <>
      <section className="project-hero">
        <div>
          <span className="eyebrow">PROJECT / OVERVIEW</span>
          <h1>{project?.name as string}</h1>
          <p>
            {(project?.description as string) ||
              "从故事出发，建立属于这个项目的制作路径。"}
          </p>
          <button
            onClick={() => {
              setTab("flow");
              if (!w.workflows.length) create("workflow");
            }}
          >
            规划制作流程 <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="hero-stamp">
          <Clapperboard size={58} />
          <span>
            每一份灵感
            <br />
            都有下一步
          </span>
        </div>
      </section>
      <div className="stats">
        <div>
          <span>项目资产</span>
          <strong>
            {w.overview.counts.assets}
            <small>项</small>
          </strong>
        </div>
        <div>
          <span>正式版本</span>
          <strong>
            {w.overview.counts.approved}
            <small>份</small>
          </strong>
        </div>
        <div>
          <span>工作事项</span>
          <strong>
            {w.overview.counts.items}
            <small>项</small>
          </strong>
        </div>
        <div>
          <span>待审核候选</span>
          <strong>
            {w.overview.pendingReviews.length}
            <small>份</small>
          </strong>
        </div>
      </div>
      <div className="overview-columns">
        <div>
          <Panel
            title="制作路线"
            action={<button onClick={() => setTab("flow")}>查看全部 ↗</button>}
          >
            {w.overview.workflow ? (
              <>
                <p className="muted">{String(w.overview.workflow.name)}</p>
                <div className="timeline">
                  {w.overview.stages.map((n, i) => (
                    <div key={str(n, "id")}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{str(n, "name")}</strong>
                        <p>{str(n, "objective")}</p>
                      </div>
                      <Badge value={str(n, "status")} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Empty>还没有发布流程。先围绕故事讨论，再保存合适的路线。</Empty>
            )}
          </Panel>
          <Panel
            title="最近的核心重点"
            action={<button onClick={() => setTab("chat")}>进入讨论 ↗</button>}
          >
            {w.highlights
              .filter((h) => h.status === "confirmed")
              .slice(0, 4)
              .map((h) => (
                <div className="highlight" key={str(h, "id")}>
                  <Badge value={str(h, "kind")} />
                  <p>{str(h, "content")}</p>
                </div>
              ))}
            {!w.highlights.some((h) => h.status === "confirmed") && (
              <p className="muted">确认过的结论会聚合到这里，不重复存储。</p>
            )}
          </Panel>
        </div>
        <div>
          <Panel
            title="故事起点"
            action={<button onClick={() => create("document")}>＋ 文稿</button>}
          >
            {w.documents.find((d) => d.kind === "outline") ? (
              <>
                <h4>
                  {str(
                    w.documents.find((d) => d.kind === "outline")!,
                    "title",
                  )}
                </h4>
                <p className="outline-preview">
                  {str(
                    w.documents.find((d) => d.kind === "outline")!,
                    "content",
                  )}
                </p>
              </>
            ) : (
              <p className="muted">
                先保存故事大纲，作为后续分析与沟通的依据。
              </p>
            )}
          </Panel>
          <Panel title="需要关注">
            {w.overview.blockers.map((i) => (
              <div className="highlight" key={str(i, "id")}>
                <Badge value="blocked" />
                <strong>{str(i, "title")}</strong>
                <p>{str(i, "block_reason")}</p>
              </div>
            ))}
            {!w.overview.blockers.length && (
              <p className="muted">目前没有阻塞事项。</p>
            )}
            <div className="runtime-note">
              <span className="status-dot" /> AI 执行器尚未接入
              <p>
                当前可管理材料、会话和记录；不会自动产生 AI 回复或调用付费生成。
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
