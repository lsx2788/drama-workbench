/** Copy an explicitly labelled video prompt verbatim; never synthesize it from a brief. */
export function videoPrompt(text: string): string | undefined {
  const sections: { title: string; depth: number; lines: string[] }[] = [];
  let section: (typeof sections)[number] | undefined;
  let fence: string | undefined;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      section?.lines.push(line);
      continue;
    }
    const heading = !fence && line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      section = { title: heading[2], depth: heading[1].length, lines: [] };
      sections.push(section);
    } else section?.lines.push(line);
  }
  const labelled = sections.filter(({ title }) =>
    /^(?:\d+[.、]\s*)?(?:(?:干净|通用|独立|可直接复制的?|可复制|外部平台)\s*)*(?:图生视频|文生视频|视频生成|视频)\s*(?:提示词|运动稿)(?:\s|[（(:：]|$)/.test(
      title,
    ),
  );
  if (labelled.length !== 1) return undefined;
  const next = sections[sections.indexOf(labelled[0]) + 1];
  if (next && next.depth > labelled[0].depth) return undefined;
  const body = labelled[0].lines.join("\n").trim();
  const blocks = Array.from(
    body.matchAll(
      /^(`{3,}|~{3,})(?:text|txt|plaintext)?[ \t]*\n([\s\S]*?)\n\1[ \t]*(?=\n|$)/gm,
    ),
  );
  if (blocks.length === 1) {
    const block = blocks[0];
    const outside = body.slice(0, block.index) + body.slice(block.index + block[0].length);
    // A single explicit prompt block may have a short introduction or usage note.
    // Extra or malformed fences make the selection ambiguous.
    return /```|~~~/.test(outside + block[2])
      ? undefined
      : block[2].trim() || undefined;
  }
  // Do not guess around an unterminated code block, lists or embedded management markup.
  if (!body || /```|~~~|^\s*[-*+>]|^\s*\d+[.)、]\s|<\/?[a-z]/im.test(body))
    return undefined;
  return body;
}
