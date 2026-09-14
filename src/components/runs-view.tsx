"use client";
import { api, str, type Workspace } from "@/client/api";
import { Badge, Panel, date } from "./ui";
export function RunsView({
  w,
  p,
  refresh,
  fail,
}: {
  w: Workspace;
  p: string;
  refresh: () => Promise<void>;
  fail: (error: unknown) => void;
}) {
  return (
    <>
      <div className="section-actions">
        <div>
          <h2>执行记录</h2>
          <p>保存实际状态、输入与配置快照，区分准备和真正执行。</p>
        </div>
      </div>
      <Panel title="请求执行">
        <p className="muted">
          当前运行适配器未接入。请求会保存快照并明确标记阻塞，不会调用外部模型。
        </p>
        <form
          className="run-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            try {
              await api(`/projects/${p}/runs`, {
                method: "POST",
                body: JSON.stringify({
                  itemId: fd.get("item"),
                  sessionId: fd.get("session"),
                  idempotencyKey: crypto.randomUUID(),
                }),
              });
              await refresh();
            } catch (err) {
              fail(err);
            }
          }}
        >
          <select aria-label="选择执行事项" name="item" required>
            <option value="">选择已就绪事项</option>
            {w.items
              .filter((i) => i.status === "ready")
              .map((i) => (
                <option key={str(i, "id")} value={str(i, "id")}>
                  {str(i, "title")}
                </option>
              ))}
          </select>
          <select aria-label="选择执行会话" name="session" required>
            <option value="">选择对应 AI 会话</option>
            {w.sessions.map((s) => (
              <option key={str(s, "id")} value={str(s, "id")}>
                {str(s, "agent_name")} · {str(s, "title")}
              </option>
            ))}
          </select>
          <button>保存执行请求</button>
        </form>
      </Panel>
      {w.runs.map((r) => (
        <Panel
          key={str(r, "id")}
          title={`执行 ${str(r, "id").slice(0, 8)}`}
          action={<Badge value={str(r, "status")} />}
        >
          <p>{str(r, "error")}</p>
          <small>{date(r.created_at)}</small>
          <details>
            <summary>查看本次输入与配置快照</summary>
            <pre>
              {JSON.stringify(JSON.parse(str(r, "input_snapshot")), null, 2)}
            </pre>
          </details>
        </Panel>
      ))}
      <Panel title="项目活动">
        {w.audit.map((a) => (
          <div className="audit-row" key={str(a, "id")}>
            <span>{str(a, "action")}</span>
            <small>{date(a.created_at)}</small>
          </div>
        ))}
        {!w.audit.length && (
          <p className="muted">审核、发布和状态变更将在这里留下记录。</p>
        )}
      </Panel>
    </>
  );
}
