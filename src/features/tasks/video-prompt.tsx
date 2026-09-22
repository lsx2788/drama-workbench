import { videoPrompt } from "@/domain/video-prompt";
import { CopyableText } from "@/shared/ui/chat-markdown";

export function VideoPrompt({ text }: { text: string }) {
  const prompt = videoPrompt(text);
  if (!prompt) return null;
  return (
    <section
      className="studio-video-prompt chat-markdown"
      aria-label="视频生成提示词"
    >
      <h4>视频生成提示词</h4>
      <p className="studio-muted">
        复制本段到视频平台，按交接说明上传对应图片。
      </p>
      <CopyableText>
        <code>{prompt}</code>
      </CopyableText>
    </section>
  );
}
