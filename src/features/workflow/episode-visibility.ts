import type { Episode } from "@/domain";

export type EpisodeColumn =
  | { kind: "episode"; episode: Episode }
  | { kind: "gap"; episodes: Episode[]; next: number };

/** Presentation only: collapsed episodes retain all tasks and dependencies. */
export function episodeColumns(
  episodes: Episode[],
  representative: number,
  revealed: number[],
): EpisodeColumn[] {
  episodes = [...episodes].sort((a, b) => a.number - b.number);
  const focus = Math.max(
    0,
    episodes.findIndex((ep) => ep.number === representative),
  );
  const start = Math.max(0, Math.min(focus - 2, episodes.length - 5));
  const visible = new Set([
    ...episodes.slice(start, start + 5).map((ep) => ep.number),
    ...revealed,
  ]);
  const columns: EpisodeColumn[] = [];
  const anchor = episodes.findIndex((ep) => ep.number === representative);
  episodes.forEach((episode, index) => {
    if (visible.has(episode.number)) {
      columns.push({ kind: "episode", episode });
      return;
    }
    const previous = columns.at(-1);
    if (previous?.kind === "gap") {
      previous.episodes.push(episode);
      if (index < anchor) previous.next = episode.number;
    } else {
      columns.push({ kind: "gap", episodes: [episode], next: episode.number });
    }
  });
  return columns;
}
