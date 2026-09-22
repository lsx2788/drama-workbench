"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  Archive,
  FileText,
  Film,
  Sparkles,
  Search,
  Clapperboard,
  ChevronDown,
  Download,
} from "lucide-react";
import { epId, taskStatus, type StudioProject, type Task } from "@/domain";
import { episodeColumns } from "./episode-visibility";
import { FlowSearch } from "./flow-search";
import type { FlowSearchResult } from "./search";
import { manualReadyTasks } from "@/domain/manual-handoff";

export function Status({
  project,
  task,
}: {
  project: StudioProject;
  task: Task;
}) {
  const status = taskStatus(project, task);
  return <span className={`studio-status ${status.tone}`}>{status.label}</span>;
}
export function ProductionMap({
  project,
  onTask,
  onArchive,
  onExport,
}: {
  project: StudioProject;
  onTask: (id: string) => void;
  onArchive: () => void;
  onExport: () => void;
}) {
  const [revealed, setRevealed] = useState<number[]>([]),
    [shots, setShots] = useState<Record<number, number[]>>({});
  const [expandedShots, setExpandedShots] = useState<Record<string, boolean>>(
    {},
  );
  const mapId = useId();
  const [searching, setSearching] = useState(false),
    [located, setLocated] = useState<FlowSearchResult | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth && !element.dataset.centered) {
        element.scrollLeft = Math.max(
          0,
          (element.scrollWidth - element.clientWidth) / 2,
        );
        element.dataset.centered = "true";
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [project.id, project.confirmed]);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const available = project.episodes.filter(
    (ep) =>
      !project.tasks[epId(ep.number)]?.placeholder &&
      (project.tasks[epId(ep.number)]?.text || ep.synopsis),
  );
  const columns = episodeColumns(
    available,
    project.representativeEpisode,
    revealed,
  );
  const manualTasks = manualReadyTasks(project);
  useEffect(() => {
    if (!located) return;
    const frame = requestAnimationFrame(() => {
      const node = nodes.current.get(located.id);
      node?.focus({ preventScroll: true });
      node?.scrollIntoView({ block: "center", inline: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [located]);
  const locate = (value: FlowSearchResult) => {
    setRevealed((v) => [...new Set([...v, value.episode])]);
    if (value.shot) {
      setExpandedShots((v) => ({
        ...v,
        [`${project.id}:${value.episode}`]: true,
      }));
      setShots((v) => ({
        ...v,
        [value.episode]: [...(v[value.episode] ?? []), value.shot!],
      }));
    }
    setLocated({ ...value });
    setSearching(false);
  };
  const ref = (id: string) => (element: HTMLButtonElement | null) => {
    if (element) nodes.current.set(id, element);
    else nodes.current.delete(id);
  };
  if (!project.confirmed)
    return (
      <div
        className="studio-empty-flow"
        aria-label="尚未确认的流程，保持空白"
      />
    );
  return (
    <section className="studio-flow-panel">
      <div className="studio-flow-caption">
        <button onClick={onExport}>
          <Download size={14} />
          资源导出
        </button>
        <span>
          {available.length
            ? `${available.length} 集 · ${Object.values(project.tasks).filter((t) => t.kind === "board" && t.text).length} 个已有分镜`
            : "制作骨架 · 随产出逐步展开"}
        </span>
        {!!project.representativeEpisode && (
          <span>
            <Sparkles size={13} />
            关键剧集：第 {project.representativeEpisode} 集
          </span>
        )}
        {(revealed.length > 0 ||
          Object.keys(shots).length > 0 ||
          Object.entries(expandedShots).some(
            ([key, open]) => open && key.startsWith(`${project.id}:`),
          )) && (
          <button
            onClick={() => {
              setRevealed([]);
              setShots({});
              setExpandedShots({});
              setLocated(null);
            }}
          >
            聚焦关键节点
          </button>
        )}
        <button
          className="studio-flow-search-toggle"
          onClick={() => setSearching(true)}
        >
          <Search size={14} />
          查找剧集 / 分镜
        </button>
      </div>
      {!!manualTasks.length && (
        <details className="studio-manual-queue" open={manualTasks.length <= 3}>
          <summary>人工制作 · {manualTasks.length} 个节点前置已验收</summary>
          <div>
            {manualTasks.map((task) => (
              <button key={task.id} onClick={() => onTask(task.id)}>
                第 {task.episode} 集
                {task.shot ? ` · 镜头 ${task.shot}` : " · 整集"} ·{" "}
                {task.delivery === "empty" ? "查看交接" : "查看视频与验收"}
              </button>
            ))}
          </div>
        </details>
      )}
      <div
        className="studio-map-scroll"
        ref={surface}
        tabIndex={0}
        aria-label="制作流程，可横向滚动查看各集"
      >
        <div
          className="studio-map"
          style={{
            width: Math.max(350, columns.length * 178 + 56),
            marginInline: "auto",
          }}
        >
          <div className="studio-preparation">
            {["source", "brief", "script"].map((id, i) => (
              <div key={id} className="studio-trunk-item">
                <button
                  className={`studio-flow-node studio-root-node ${id === "script" ? "script" : ""}`}
                  onClick={() => onTask(id)}
                >
                  <FileText size={18} />
                  <span>
                    <small>0{i + 1}</small>
                    <strong>{project.tasks[id].title}</strong>
                  </span>
                  <Status project={project} task={project.tasks[id]} />
                </button>
              </div>
            ))}
          </div>
          <div
            className="studio-episode-fan"
            style={{
              gridTemplateColumns: `repeat(${columns.length || 1},minmax(0,1fr))`,
            }}
          >
            {columns.map((column) => {
              if (column.kind === "gap")
                return (
                  <div
                    className="studio-episode-lane studio-hidden-episodes"
                    key={`gap-${column.next}`}
                  >
                    <button
                      className="studio-flow-node studio-episode-gap"
                      aria-label={`展开第 ${column.next} 集`}
                      onClick={() => setRevealed((v) => [...v, column.next])}
                    >
                      <strong>…</strong>
                      <small>还有 {column.episodes.length} 集</small>
                    </button>
                  </div>
                );
              const ep = column.episode,
                n = ep.number,
                pilot = n === project.representativeEpisode;
              const shotTasks = Object.values(project.tasks)
                .filter((t) => t.kind === "board" && t.episode === n && t.text)
                .sort((a, b) => a.shot! - b.shot!);
              const focus =
                ep.representativeShot ??
                (pilot ? project.representativeShot : 0);
              const shotColumns = episodeColumns(
                shotTasks.map((t) => ({
                  number: t.shot!,
                  title: t.title,
                  synopsis: t.text,
                  shots: 0,
                })),
                focus,
                shots[n] ?? [],
              );
              const assembly = project.tasks[`episode-${n}-assembly`],
                board = project.tasks[`episode-${n}-storyboard`];
              const expansionKey = `${project.id}:${n}`;
              const shotsOpen = !!expandedShots[expansionKey];
              const shotListId = `${mapId}-shots-${n}`;
              return (
                <div
                  key={n}
                  className={`studio-episode-lane ${pilot ? "representative" : ""}`}
                >
                  <button
                    ref={ref(epId(n))}
                    className={`studio-flow-node studio-episode-node ${pilot ? "pilot" : ""} ${located?.id === epId(n) ? "located" : ""}`}
                    onClick={() => onTask(epId(n))}
                    aria-label={`查看第 ${n} 集剧本${pilot ? "，关键剧集" : ""}`}
                  >
                    <span className="studio-node-kicker">
                      EP {String(n).padStart(2, "0")}
                      {pilot && (
                        <span className="studio-key-badge">
                          <Sparkles size={11} />
                          关键剧集
                        </span>
                      )}
                    </span>
                    <strong>{ep.title}</strong>
                    <Status project={project} task={project.tasks[epId(n)]} />
                  </button>
                  {board && (
                    <button
                      className="studio-branch-toggle"
                      onClick={() => onTask(board.id)}
                    >
                      本集分镜设计 · {shotTasks.length} 镜
                    </button>
                  )}
                  {!!shotColumns.length && (
                    <button
                      className="studio-shots-expand"
                      aria-label={`${shotsOpen ? "收起" : "展开"}第 ${n} 集分镜`}
                      aria-expanded={shotsOpen}
                      aria-controls={shotListId}
                      onClick={() =>
                        setExpandedShots((v) => ({
                          ...v,
                          [expansionKey]: !v[expansionKey],
                        }))
                      }
                    >
                      <ChevronDown size={18} aria-hidden="true" />
                    </button>
                  )}
                  {!!shotColumns.length && (
                    <div
                      id={shotListId}
                      className="studio-shot-list"
                      hidden={!shotsOpen}
                    >
                      {shotColumns.map((c) => {
                        if (c.kind === "gap")
                          return (
                            <button
                              className="studio-shot-gap"
                              key={`gap-${c.next}`}
                              aria-label={`展开第 ${n} 集镜头 ${c.next}`}
                              onClick={() =>
                                setShots((v) => ({
                                  ...v,
                                  [n]: [...(v[n] ?? []), c.next],
                                }))
                              }
                            >
                              …<small>还有 {c.episodes.length} 镜</small>
                            </button>
                          );
                        const s = c.episode.number,
                          t = shotTasks.find((t) => t.shot === s)!;
                        return (
                          <div className="studio-shot-leaf" key={s}>
                            <button
                              ref={ref(t.id)}
                              className={`studio-flow-node studio-shot-node ${s === focus ? "pilot" : ""} ${located?.id === t.id ? "located" : ""}`}
                              onClick={() => onTask(t.id)}
                              aria-label={`查看第 ${n} 集镜头 ${s}${s === focus ? "，关键镜头" : ""}`}
                            >
                              <span>
                                <b>{String(s).padStart(2, "0")}</b>
                                {s === focus && (
                                  <span className="studio-key-badge">
                                    <Sparkles size={11} />
                                    关键镜头
                                  </span>
                                )}
                              </span>
                              <strong>{t.title}</strong>
                              <Status project={project} task={t} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {assembly?.text && (
                    <button
                      className="studio-flow-node studio-video-node"
                      onClick={() => onTask(assembly.id)}
                    >
                      <Film size={17} />
                      <strong>第 {n} 集视频</strong>
                      <Status project={project} task={assembly} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="studio-archive-trunk">
            <button
              className="studio-flow-node studio-archive"
              onClick={onArchive}
            >
              <Archive size={18} />
              <strong>归档</strong>
            </button>
          </div>
        </div>
      </div>
      <footer className="studio-map-legend">
        <span>
          <Clapperboard size={13} />
          点击节点查看任务、AI 与产出
        </span>
        <span>未填充的剧集与镜头暂不展示</span>
      </footer>
      {searching && (
        <FlowSearch
          project={project}
          onClose={() => setSearching(false)}
          onLocate={locate}
        />
      )}
    </section>
  );
}
