"use client";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, str, type RecordData } from "@/client/api";
import { PromptDialog } from "./prompt-dialog";
import { date } from "./ui";

export function ProjectTrashDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: () => Promise<unknown>;
}) {
  const [rows, setRows] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    api<RecordData[]>("/projects/trash")
      .then((data) => {
        if (current) setRows(data);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);
  return (
    <PromptDialog
      title="垃圾箱"
      onClose={onClose}
      busy={!!busy}
      closeLabel="关闭垃圾箱"
    >
      <p className="trash-description">
        删除的剧本保留在这里，聊天、文件和资产都可以随剧本一起恢复。
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {loading ? (
        <p>正在读取…</p>
      ) : !rows.length ? (
        <p className="empty">垃圾箱是空的</p>
      ) : (
        <ul className="trash-list">
          {rows.map((row) => (
            <li key={str(row, "id")}>
              <div>
                <strong>{str(row, "name")}</strong>
                <small>删除于 {date(row.deleted_at)}</small>
              </div>
              <button
                disabled={!!busy}
                onClick={async () => {
                  const id = str(row, "id");
                  setBusy(id);
                  setError("");
                  try {
                    await api(`/projects/${id}/restore`, { method: "POST" });
                    setRows((previous) => previous.filter((r) => r.id !== id));
                    await onRestored();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "恢复失败");
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <RotateCcw size={14} /> {busy === row.id ? "正在恢复…" : "恢复"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PromptDialog>
  );
}

export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: RecordData;
  onClose: () => void;
  onDeleted: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <PromptDialog
      title="删除剧本？"
      onClose={onClose}
      busy={busy}
      closeLabel="取消删除"
    >
      <p className="trash-description">
        “{str(project, "name")}
        ”将移入垃圾箱，聊天、原文和资产都会保留，之后可以恢复。
      </p>
      <p className="trash-description">
        这个剧本已打开的页面会关闭，未发送的输入不会保留。
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="trash-actions">
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="trash-confirm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const id = str(project, "id");
              await api(`/projects/${id}`, {
                method: "DELETE",
                body: JSON.stringify({ confirmed: true }),
              });
              await onDeleted(id);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "删除失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在移入…" : "移入垃圾箱"}
        </button>
      </div>
    </PromptDialog>
  );
}
