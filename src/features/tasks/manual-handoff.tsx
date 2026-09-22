"use client";
import { useState } from "react";
import type { MediaFile, StudioProject, Task } from "@/domain";
import { manualHandoff } from "@/domain/manual-handoff";
import { ChatMarkdown } from "@/shared/ui/chat-markdown";
import { FilePreview } from "@/shared/ui/file-preview";
import { VideoPrompt } from "./video-prompt";

export function ManualHandoff({
  project,
  task,
  files,
  onSelect,
}: {
  project: StudioProject;
  task: Task;
  files: Record<string, MediaFile[]>;
  onSelect: (id: string) => void;
}) {
  const handoff = manualHandoff(project, task, files);
  const [feedback, setFeedback] = useState("");
  const exportText = () =>
    handoff.text.replace(
      /\]\(\/api\/files\//g,
      `](${window.location.origin}/api/files/`,
    );
  return (
    <section className="studio-manual-handoff">
      <div className="studio-output-heading">
        <h4>人工制作交接</h4>
        <span className={`studio-status ${handoff.ready ? "green" : "amber"}`}>
          {handoff.ready ? "可以开始制作" : "等待前置成果"}
        </span>
      </div>
      <p>
        先使用已验收文件与本版验收备注，再核对资产包修订及原分镜。制作完成后，在下方上传视频。
      </p>
      <div className="studio-media-grid">
        {handoff.primary
          .flatMap((input) => input.files)
          .map((file) => (
            <FilePreview key={file.id ?? file.url} file={file} />
          ))}
      </div>
      {handoff.primary
        .flatMap((input) => input.acceptance)
        .map((event) => (
          <details key={event.id} className="studio-handoff-acceptance">
            <summary>本版验收依据与规格例外 · v{event.revision}</summary>
            <ChatMarkdown text={event.text} />
          </details>
        ))}
      {handoff.primary
        .filter((input) => input.task.delivery === "approved")
        .map((input) => (
          <VideoPrompt key={input.task.id} text={input.task.text} />
        ))}
      <p className="studio-notice">
        原分镜可能早于资产修订。请同时核对下列依据；单个镜头获准的尺寸或内容例外，不自动适用于其他镜头。
      </p>
      {handoff.inputs.map((input) => (
        <details key={input.task.id}>
          <summary>
            {input.task.title} · v{input.task.revision} ·{" "}
            {input.task.delivery === "approved" ? "已验收" : "待验收"}
          </summary>
          <button onClick={() => onSelect(input.task.id)}>打开来源节点</button>
          <ChatMarkdown text={input.task.text || "暂无文本"} />
          {input.acceptance.map((event) => (
            <blockquote key={event.id}>
              <ChatMarkdown text={event.text} />
            </blockquote>
          ))}
        </details>
      ))}
      <div className="studio-text-actions">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(exportText());
              setFeedback("已复制交接说明");
            } catch {
              setFeedback("复制失败，请下载交接说明");
            }
          }}
        >
          复制交接说明
        </button>
        <button
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([exportText()], { type: "text/markdown;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `${task.id}-交接说明.md`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          下载交接说明
        </button>
      </div>
      <small role="status">{feedback}</small>
    </section>
  );
}
