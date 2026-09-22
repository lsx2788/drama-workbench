import { epId, shotId } from "./queries";
import type { Episode, StudioProject, Task, TaskKind } from "./types";

export function taskDefinition(
  id: string,
  kind: TaskKind,
  title: string,
  dependencies: string[],
  episode?: number,
  shot?: number,
): Task {
  return {
    id,
    kind,
    title,
    objective: `交付可供后续使用的${title}，遵守制作需求与已确认基准。`,
    dependencies,
    episode,
    shot,
    enabled: true,
    reviewEnabled: kind !== "brief",
    delivery: "empty",
    text: "",
    revision: 0,
    history: [],
    assetIds: [],
    reuseReason: "",
  };
}
export function emptyProject(id = "", name = "新建剧本"): StudioProject {
  return {
    id,
    name,
    confirmed: false,
    representativeEpisode: 0,
    representativeShot: 0,
    episodes: [],
    assets: [],
    sources: [],
    messages: [],
    events: [],
    tasks: {
      source: taskDefinition("source", "source", "原作理解", []),
      brief: taskDefinition("brief", "brief", "制作需求", ["source"]),
      script: taskDefinition("script", "script", "整体剧本", ["brief"]),
    },
  };
}
export function productionTasks(episodes: Episode[]): Task[] {
  const tasks: Task[] = [];
  for (const ep of episodes) {
    const n = ep.number;
    tasks.push(
      taskDefinition(
        epId(n),
        "episode",
        `第 ${n} 集 · ${ep.title}`,
        ["script"],
        n,
      ),
    );
    for (let s = 1; s <= ep.shots; s++) {
      tasks.push(
        taskDefinition(shotId(n, s), "board", `镜头 ${s}`, [epId(n)], n, s),
      );
      for (const [kind, title, previous] of [
        ["assets", "基础资产准备", "board"],
        ["frames", "镜头画面制作", "assets"],
        ["video", "镜头视频 · 人工处理", "frames"],
      ] as const)
        tasks.push(
          taskDefinition(
            shotId(n, s, kind),
            kind,
            title,
            [shotId(n, s, previous)],
            n,
            s,
          ),
        );
    }
    tasks.push(
      taskDefinition(
        `episode-${n}-assembly`,
        "assembly",
        `第 ${n} 集视频`,
        Array.from({ length: ep.shots }, (_, i) => shotId(n, i + 1, "video")),
        n,
      ),
    );
  }
  return tasks;
}
