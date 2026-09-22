"use client";
import { useEffect, useState } from "react";
import { readRaw, type RawSession, type RawEvent } from "@/application/raw-api";
import { StudioDialog } from "@/shared/ui/dialog";
import { ChatMarkdown } from "@/shared/ui/chat-markdown";

const kinds: Record<string, string> = {
  input: "实际发送内容（用户角色）",
  assistant: "AI 原始回复",
  tool_call: "调用系统能力",
  tool_result: "系统返回",
};
export function RawConversations({
  projectId,
  query,
}: {
  projectId: string;
  query: string;
}) {
  const [sessions, setSessions] = useState<RawSession[]>([]),
    [selected, setSelected] = useState<RawSession | null>(null);
  const [events, setEvents] = useState<RawEvent[]>([]),
    [before, setBefore] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    readRaw(projectId)
      .then((r) => {
        if (alive) setSessions(r.sessions ?? []);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setBusy(true);
    setEvents([]);
    setError("");
    readRaw(projectId, selected.id)
      .then((r) => {
        if (alive) {
          setEvents(r.events ?? []);
          setBefore(r.before ?? null);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, selected]);
  const name = (s: RawSession) =>
    s.role === "coordinator"
      ? "总控 AI"
      : `${s.title ?? s.scope} · ${s.role === "reviewer" ? "审核 AI" : "制作 AI"}`;
  return (
    <>
      <p className="studio-muted">
        实际发送、AI 回复与系统转交记录。历史会话未采集的原文不会补写。
      </p>
      <div className="studio-record-list">
        {sessions
          .filter((s) => name(s).includes(query))
          .map((s) => (
            <button key={s.id} onClick={() => setSelected(s)}>
              <span>
                <strong>{name(s)}</strong>
                <small>{s.count} 条原始记录</small>
              </span>
            </button>
          ))}
      </div>
      {!sessions.length && <p>还没有原始会话。</p>}
      {error && !selected && <p role="alert">{error}</p>}
      {selected && (
        <StudioDialog
          title={name(selected)}
          wide
          onClose={() => setSelected(null)}
        >
          <p className="studio-muted">
            会话编号：{selected.threadId ?? "尚未建立"}
          </p>
          {error && <p role="alert">{error}</p>}
          {before && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await readRaw(projectId, selected.id, before);
                  setEvents((old) => [...(r.events ?? []), ...old]);
                  setBefore(r.before ?? null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "读取失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              查看更早记录
            </button>
          )}
          {busy && <p>正在读取…</p>}
          {!busy && !events.length && (
            <p>此历史会话尚无原始记录；新执行开始后会保存实际沟通。</p>
          )}
          <div className="studio-raw-events">
            {events.map((e) => (
              <article key={e.seq}>
                <header>
                  <strong>
                    {e.sender} → {e.recipient}
                  </strong>
                  <time>{new Date(e.created_at).toLocaleString("zh-CN")}</time>
                </header>
                <small>
                  {kinds[e.kind] ?? e.kind} ·{" "}
                  {e.revision != null ? `产出 v${e.revision}` : "总控会话"}
                </small>
                {e.kind === "assistant" ? (
                  <ChatMarkdown text={e.body} />
                ) : (
                  <details open={e.kind === "input"}>
                    <summary>
                      {e.kind === "input"
                        ? "查看实际请求正文"
                        : "查看系统原始记录"}
                    </summary>
                    <pre>{format(e.body)}</pre>
                  </details>
                )}
                <details>
                  <summary>执行信息</summary>
                  <p>
                    执行：{e.run_id}
                    <br />
                    会话：{e.thread_id}
                    <br />
                    轮次：{e.turn_id}
                  </p>
                </details>
              </article>
            ))}
          </div>
        </StudioDialog>
      )}
    </>
  );
}
function format(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
