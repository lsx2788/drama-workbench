"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { str, type RecordData } from "@/client/api";
import type { AiConnectionStatus } from "@/shared/ai-connection";
import { PromptDialog } from "./prompt-dialog";
import { AgentPromptEditor } from "./agent-prompt-settings";

export function GroupMembers({
  members,
  agents,
  p,
  refresh,
  connection,
}: {
  members: RecordData[];
  agents: RecordData[];
  p: string;
  refresh: () => Promise<void>;
  connection: AiConnectionStatus | null;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const selected = members.find((m) => m.id === selectedId);
  const selectedAgent = agents.find((a) => a.id === selected?.agent_id);
  return (
    <>
      <div className="group-member-bar">
        <span className="group-avatar human">你</span>
        {members
          .filter((m) => m.membership_status === "active")
          .map((m) => (
            <button
              type="button"
              key={str(m, "id")}
              className="group-member-name"
              aria-label={`查看${str(m, "name")}的配置`}
              onClick={() => setSelectedId(str(m, "id"))}
            >
              {str(m, "name")}
            </button>
          ))}
        <button
          type="button"
          className="group-members-open"
          onClick={() => setOpen(true)}
        >
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
                <button
                  type="button"
                  key={str(m, "id")}
                  className="group-member-card"
                  onClick={() => setSelectedId(str(m, "id"))}
                >
                  <div>
                    <strong>{str(m, "name")}</strong>
                    <small>
                      {str(m, "title")} ·{" "}
                      {m.membership_status === "paused" ? "已退出本轮" : "在场"}
                    </small>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ))}
          </div>
        </PromptDialog>
      )}
      {selected && (
        <AgentPromptEditor
          key={str(selected, "agent_id")}
          p={p}
          agentId={str(selected, "agent_id")}
          refresh={refresh}
          onClose={() => setSelectedId("")}
          memberInfo={
            <section
              className="member-configuration-summary"
              aria-label="成员信息"
            >
              {!!selectedAgent?.purpose && (
                <p>{str(selectedAgent, "purpose")}</p>
              )}
              <dl>
                <dt>参与状态</dt>
                <dd>
                  {selected.membership_status === "paused"
                    ? "已退出本轮"
                    : "在场"}
                </dd>
                <dt>当前会话</dt>
                <dd>{str(selected, "title")}</dd>
                <dt>当前接入</dt>
                <dd>
                  {connection
                    ? `${connection.provider === "codex" ? "本机 Codex" : "OpenAI API"} · ${connection.configured ? "已连接" : "未连接"}`
                    : "正在读取"}
                </dd>
                <dt>接入模型</dt>
                <dd>{connection?.model || "未配置"}</dd>
              </dl>
              <details>
                <summary>会话信息</summary>
                <dl>
                  <dt>会话编号</dt>
                  <dd>{str(selected, "id")}</dd>
                  <dt>已保存的外部会话</dt>
                  <dd>{str(selected, "external_session_id") || "尚未建立"}</dd>
                </dl>
              </details>
            </section>
          }
        />
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
