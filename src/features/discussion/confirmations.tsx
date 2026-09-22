"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import type { Message, StudioProject } from "@/domain";
import { StudioDialog } from "@/shared/ui/dialog";

export function SkipConfirmationDialog({
  message,
  busy,
  onClose,
  onConfirm,
}: {
  message: Message;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <StudioDialog
      title="跳过这个问题？"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="studio-skip-preview">{message.text}</p>
      <p>跳过后将取消待确认提醒，保留原问题。跳过不代表同意或验收通过。</p>
      <div className="studio-skip-actions">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button className="studio-primary" disabled={busy} onClick={onConfirm}>
          {busy ? "保存中…" : "确认跳过"}
        </button>
      </div>
    </StudioDialog>
  );
}

export function ConfirmationInbox({
  projects,
  busy,
  onOpen,
  onSkip,
}: {
  projects: StudioProject[];
  busy: boolean;
  onOpen: (projectId: string, messageId: string) => void;
  onSkip: (projectId: string, messageId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<{
    projectId: string;
    message: Message;
  } | null>(null);
  const groups = projects
    .map((project) => ({
      project,
      messages: project.messages.filter(
        (m) => m.confirmation?.status === "pending",
      ),
    }))
    .filter((group) => group.messages.length);
  const count = groups.reduce((sum, group) => sum + group.messages.length, 0);
  return (
    <>
      <button
        className={`studio-global-confirmations ${count ? "has-pending" : ""}`}
        aria-label={`待确认 ${count}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={15} />
        <span>待确认</span>
        <strong aria-live="polite" aria-atomic="true">
          {count}
        </strong>
      </button>
      {open && (
        <StudioDialog
          title={`待确认问题（${count}）`}
          onClose={() => setOpen(false)}
        >
          <div className="studio-confirmation-groups">
            {groups.map(({ project, messages }) => (
              <section key={project.id}>
                <h3>
                  {project.name}
                  <small>{messages.length} 项</small>
                </h3>
                <div className="studio-pending-list">
                  {messages.map((message) => (
                    <div className="studio-pending-item" key={message.id}>
                      <button
                        onClick={() => {
                          setOpen(false);
                          onOpen(project.id, message.id);
                        }}
                      >
                        <strong>{message.sender}</strong>
                        <span>
                          {message.text.length > 180
                            ? `${message.text.slice(0, 180)}…`
                            : message.text}
                        </span>
                        <small>前往聊天并引用回复</small>
                      </button>
                      <button
                        className="studio-skip-question"
                        disabled={busy}
                        onClick={() =>
                          setSkip({ projectId: project.id, message })
                        }
                      >
                        跳过
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!count && <p className="studio-muted">没有待确认的问题</p>}
          </div>
        </StudioDialog>
      )}
      {skip && (
        <SkipConfirmationDialog
          message={skip.message}
          busy={busy}
          onClose={() => setSkip(null)}
          onConfirm={async () => {
            if (await onSkip(skip.projectId, skip.message.id)) setSkip(null);
          }}
        />
      )}
    </>
  );
}
