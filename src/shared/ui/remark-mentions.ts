type Node = { type: string; value?: string; children?: Node[] };

/** Only format known members in prose; leave code, links and existing bold text intact. */
export function remarkMentions({ names = [] }: { names?: string[] } = {}) {
  const alternatives = [...new Set(names)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((name) =>
      name
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s*"),
    );
  if (!alternatives.length) return;
  const pattern = new RegExp(
    `(?<![\\w.])@(?:${alternatives.join("|")})(?![A-Za-z0-9_])[ \\t]*`,
    "gu",
  );
  return (tree: unknown) => {
    function visit(node: Node) {
      if (
        !node.children ||
        [
          "code",
          "inlineCode",
          "html",
          "link",
          "linkReference",
          "strong",
        ].includes(node.type)
      )
        return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== "text" || !child.value) {
          visit(child);
          return [child];
        }
        const value = child.value,
          parts: Node[] = [];
        let offset = 0;
        for (const match of value.matchAll(pattern)) {
          const start = match.index!;
          if (start > offset)
            parts.push({ type: "text", value: value.slice(offset, start) });
          parts.push({
            type: "strong",
            children: [{ type: "text", value: match[0].trimEnd() }],
          });
          parts.push({ type: "text", value: " " });
          offset = start + match[0].length;
        }
        if (!parts.length) return [child];
        if (offset < value.length)
          parts.push({ type: "text", value: value.slice(offset) });
        return parts;
      });
    }
    visit(tree as Node);
  };
}
