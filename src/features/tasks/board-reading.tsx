import { ChatMarkdown } from "@/shared/ui/chat-markdown";
import { boardSections } from "./board-sections";

export function BoardReading({ text }: { text: string }) {
  const sections = boardSections(text);
  if (!sections) return <ChatMarkdown text={text} />;
  return (
    <div className="studio-board-reading">
      <ChatMarkdown
        text={sections.main.replace(
          /^([-*+]\s+)([^*\n：:]{1,35})([：:])/gm,
          "$1**$2$3**",
        )}
      />
      {sections.sound && (
        <details className="studio-secondary-section">
          <summary>声音与字幕</summary>
          <ChatMarkdown text={sections.sound} />
        </details>
      )}
      {sections.reference && (
        <details className="studio-secondary-section">
          <summary>制作参考与长提示词</summary>
          <p className="studio-muted">
            以下为本版分镜原文。制作时请结合最新已验收资产与画面中的正式修订。
          </p>
          <ChatMarkdown text={sections.reference} />
        </details>
      )}
    </div>
  );
}
