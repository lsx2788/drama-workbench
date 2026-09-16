import type { Root } from "mdast";

type Node = {
  type: string;
  value?: string;
  children?: Node[];
};
const textNode = (value: string): Node => ({ type: "text", value });
const mentionNode = (name: string): Node => ({
  type: "strong",
  children: [textNode(`@${name}`)],
});

/** Presentation only: recipient identities come from persisted delivery metadata. */
export function remarkChatMentions({ names = [] }: { names?: string[] } = {}) {
  return (root: Root) => {
    const unique = [...new Set(names.filter(Boolean))];
    if (!unique.length) return;
    const escaped = [...unique]
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(
      `(^|[^\\w@])[@＠](${escaped.join("|")})(?=$|[\\s，。！？、：；,.!?:;])`,
      "gu",
    );
    const found = new Set<string>();
    const visit = (node: Node, alreadyBold = false) => {
      // Literal examples and link targets must keep their original meaning.
      if (
        ["code", "inlineCode", "link", "image", "html", "blockquote"].includes(
          node.type,
        )
      )
        return;
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text") {
          visit(child, alreadyBold || child.type === "strong");
          return [child];
        }
        const value = child.value ?? "";
        const pieces: Node[] = [];
        let offset = 0;
        for (const match of value.matchAll(pattern)) {
          const start = match.index! + match[1].length;
          const end = match.index! + match[0].length;
          found.add(match[2]);
          pieces.push(textNode(value.slice(offset, start)));
          pieces.push(
            alreadyBold ? textNode(`@${match[2]}`) : mentionNode(match[2]),
          );
          offset = end;
        }
        if (!offset) return [child];
        pieces.push(textNode(value.slice(offset)));
        return pieces;
      });
    };
    const tree = root as unknown as Node;
    visit(tree);
    const missing = unique.filter((name) => !found.has(name));
    if (!missing.length) return;
    const prefix = missing.flatMap((name) => [
      mentionNode(name),
      textNode(" "),
    ]);
    const first = tree.children![0];
    if (first?.type === "paragraph") first.children!.unshift(...prefix);
    else tree.children!.unshift({ type: "paragraph", children: prefix });
  };
}
