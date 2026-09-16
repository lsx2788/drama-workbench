export interface MentionMatch {
  name: string;
  start: number;
  end: number;
}

/** Match complete, selected member names anywhere, preferring the longest name. */
export function findMentions(text: string, names: string[]): MentionMatch[] {
  const escaped = [...new Set(names.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return [];
  const pattern = new RegExp(
    `[@＠](${escaped.join("|")})(?=$|[\\s\\p{P}@＠])`,
    "gu",
  );
  const matches: MentionMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    // Ignore email addresses, but permit consecutive selected mentions.
    if (/[\w.@＠]/.test(text[start - 1] ?? "") && matches.at(-1)?.end !== start)
      continue;
    matches.push({ name: match[1], start, end: start + match[0].length });
  }
  return matches;
}

export function selectedMentionIds(
  text: string,
  selected: { id: string; name: string }[],
) {
  const names = new Set(
    findMentions(
      text,
      selected.map((m) => m.name),
    ).map((m) => m.name),
  );
  return [
    ...new Set(selected.filter((m) => names.has(m.name)).map((m) => m.id)),
  ];
}

export function mentionAt(
  text: string,
  caret: number,
  selectedNames: string[],
) {
  const match = /[@＠]([^\n@＠]{0,60})$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const completed = findMentions(text.slice(0, caret), selectedNames);
  if (
    /[\w.@＠]/.test(text[match.index - 1] ?? "") &&
    !completed.some((m) => m.end === match.index)
  )
    return null;
  if (completed.some((m) => m.start === match.index)) return null;
  return { start: match.index, end: caret, query: match[1].trim() };
}
