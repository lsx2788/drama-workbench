export function mentionAt(
  text: string,
  caret: number,
  selectedNames: string[],
) {
  const match = /[@＠]([^\n@＠]{0,60})$/u.exec(text.slice(0, caret));
  if (!match || /[\w.@]/.test(text[match.index - 1] ?? "")) return null;
  if (selectedNames.some((name) => match[1].startsWith(`${name} `)))
    return null;
  return { start: match.index, end: caret, query: match[1].trim() };
}
