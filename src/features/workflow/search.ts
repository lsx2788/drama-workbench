import { epId, type StudioProject } from "@/domain";

export type FlowSearchKind = "episode" | "shot";
export type FlowSearchResult = {
  id: string;
  episode: number;
  shot?: number;
  title: string;
  location: string;
  text: string;
};

/** Search current project content, including nodes hidden by presentation. */
export function searchWorkflow(
  project: StudioProject,
  kind: FlowSearchKind,
  query: string,
): FlowSearchResult[] {
  const entries: FlowSearchResult[] =
    kind === "episode"
      ? project.episodes
          .filter(
            (ep) =>
              !project.tasks[epId(ep.number)]?.placeholder &&
              (project.tasks[epId(ep.number)]?.text || ep.synopsis),
          )
          .map((ep) => ({
            id: epId(ep.number),
            episode: ep.number,
            title: ep.title,
            location: `第 ${ep.number} 集`,
            text: `${ep.synopsis} ${project.tasks[epId(ep.number)]?.text ?? ""}`,
          }))
      : Object.values(project.tasks)
          .filter(
            (t) =>
              t.kind === "board" &&
              !!t.text &&
              t.episode !== undefined &&
              t.shot !== undefined,
          )
          .map((t) => ({
            id: t.id,
            episode: t.episode!,
            shot: t.shot!,
            title: t.title.split(" · ").slice(1).join(" · ") || t.title,
            location: `第 ${t.episode} 集 · 镜头 ${String(t.shot).padStart(2, "0")}`,
            text: t.text,
          }));
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
  const pair = normalized.match(/^(\d+)\s*[-/.]\s*(\d+)$/);
  const ep = normalized.match(/(?:第\s*)?(\d+)\s*集|ep\s*(\d+)/);
  const shot = normalized.match(
    /(?:镜头|分镜|shot|s)\s*(\d+)|(?:第\s*)?(\d+)\s*(?:镜|条)/,
  );
  const episodeNumber = pair
    ? Number(pair[1])
    : ep
      ? Number(ep[1] ?? ep[2])
      : undefined;
  const shotNumber = pair
    ? Number(pair[2])
    : shot
      ? Number(shot[1] ?? shot[2])
      : undefined;
  const remainder = normalized
    .replace(pair?.[0] ?? /$^/, "")
    .replace(ep?.[0] ?? /$^/, "")
    .replace(shot?.[0] ?? /$^/, "")
    .trim();
  const numericOnly = /^\d+$/.test(remainder) ? Number(remainder) : undefined;
  const tokens =
    numericOnly === undefined ? remainder.split(/\s+/).filter(Boolean) : [];
  return entries
    .filter((entry) => {
      if (episodeNumber !== undefined && entry.episode !== episodeNumber)
        return false;
      if (shotNumber !== undefined && entry.shot !== shotNumber) return false;
      if (
        numericOnly !== undefined &&
        (kind === "episode" ? entry.episode : entry.shot) !== numericOnly
      )
        return false;
      const content = `${entry.title} ${entry.text}`
        .normalize("NFKC")
        .toLocaleLowerCase();
      return tokens.every((token) => content.includes(token));
    })
    .sort((a, b) => a.episode - b.episode || (a.shot ?? 0) - (b.shot ?? 0));
}
