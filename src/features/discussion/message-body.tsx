import { ChatMarkdown } from "@/shared/ui/chat-markdown";

export function MessageBody({
  text,
  mentionNames,
  needsReply,
  isLatestReply,
}: {
  text: string;
  mentionNames: string[];
  needsReply: boolean;
  isLatestReply: boolean;
}) {
  const lines = text.split("\n").filter((line) => line.trim());
  if (needsReply || isLatestReply || (text.length <= 160 && lines.length <= 4))
    return <ChatMarkdown text={text} mentionNames={mentionNames} />;
  const preview = lines
    .slice(0, 2)
    .join(" ")
    .replace(/^[#>\s]+/, "")
    .replace(/\*\*/g, "")
    .slice(0, 140);
  return (
    <details className="studio-message-details">
      <summary>
        <div className="studio-message-summary">
          <ChatMarkdown text={`${preview}${text.length > preview.length ? "…" : ""}`} mentionNames={mentionNames} />
        </div>
        <span className="studio-message-expand">展开全文</span>
        <span className="studio-message-contract">收起全文</span>
      </summary>
      <ChatMarkdown text={text} mentionNames={mentionNames} />
    </details>
  );
}
