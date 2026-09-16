"use client";
import { useState } from "react";
import { api, str, type RecordData } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";

export function GroupMembers({
  p,
  groupId,
  members,
  busy,
  refresh,
  fail,
}: {
  p: string;
  groupId: string;
  members: RecordData[];
  busy: boolean;
  refresh: () => Promise<void>;
  fail: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false);
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
        <PromptDialog
          title="讨论成员"
          busy={saving}
          onClose={() => setOpen(false)}
        >
          <p className="muted">
            退出本轮讨论后不再接收新消息。会话和历史保留，可随时重新加入。
          </p>
          <div className="group-member-list">
            {members.map((m) => (
              <div key={str(m, "id")} className="group-member-card">
                <div>
                  <strong>{str(m, "name")}</strong>
                  <small>
                    {str(m, "title")} ·{" "}
                    {m.membership_status === "paused" ? "已退出本轮" : "在场"}
                  </small>
                  <details>
                    <summary>会话信息</summary>
                    <small>内部 ID：{str(m, "id")}</small>
                    <small>
                      Codex ID：{str(m, "external_session_id") || "尚未执行"}
                    </small>
                  </details>
                </div>
                {m.id !== groupId && (
                  <button
                    type="button"
                    disabled={busy || saving}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await api(
                          `/projects/${p}/sessions/${groupId}/group-members`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({
                              sessionId: m.id,
                              status:
                                m.membership_status === "paused"
                                  ? "active"
                                  : "paused",
                            }),
                          },
                        );
                        await refresh();
                      } catch (e) {
                        fail(e);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    {m.membership_status === "paused" ? "重新加入" : "退出本轮"}
                  </button>
                )}
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
        <small>选择接收者 · 总控同时收到</small>
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
          当前没有其他在场 AI，总控建立协作后可在这里选择。
        </p>
      )}
    </div>
  );
}
