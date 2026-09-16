"use client";
import { useState } from "react";
import { str, type RecordData } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";

export function GroupMembers({ members }: { members: RecordData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="group-member-bar">
        <span className="group-avatar human">你</span>
        {members
          .filter((m) => m.membership_status === "active")
          .map((m) => (
            <span key={str(m, "id")} className="group-member-name">
              {str(m, "name")}
            </span>
          ))}
        <button type="button" onClick={() => setOpen(true)}>
          成员
        </button>
      </div>
      {open && (
        <PromptDialog title="讨论成员" onClose={() => setOpen(false)}>
          <p className="muted">
            总控根据当前任务邀请或结束协作。想继续与某位 AI
            讨论，可以直接告诉总控；原来的会话和历史会保留。
          </p>
          <div className="group-member-list">
            {members
              .filter((m) => m.membership_status !== "available")
              .map((m) => (
                <div key={str(m, "id")} className="group-member-card">
                  <div>
                    <strong>{str(m, "name")}</strong>
                    <small>
                      {str(m, "title")} ·{" "}
                      {m.membership_status === "paused" ? "已退出本轮" : "在场"}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        </PromptDialog>
      )}
    </>
  );
}
export function MentionPicker({
  members,
  onSelect,
  onClose,
}: {
  members: RecordData[];
  onSelect: (m: RecordData) => void;
  onClose: () => void;
}) {
  return (
    <div className="mention-picker" role="group" aria-label="选择要 @ 的 AI">
      <div>
        <small>选择成员</small>
        <button type="button" onClick={onClose} aria-label="关闭提及选择">
          ×
        </button>
      </div>
      {members.length ? (
        members.map((m) => (
          <button type="button" key={str(m, "id")} onClick={() => onSelect(m)}>
            <strong>@{str(m, "name")}</strong>
            <small>{str(m, "title")}</small>
          </button>
        ))
      ) : (
        <p className="muted">
          没有匹配的在场 AI。需要其他协作者时，可以告诉总控。
        </p>
      )}
    </div>
  );
}
