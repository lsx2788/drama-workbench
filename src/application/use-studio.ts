"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSnapshotSync, pollDelay } from "./snapshot-sync";
import { studioJson, StudioConnectionError } from "./studio-http";
import type {
  MediaFile,
  StudioProject,
  StudioState,
  TaskAction,
} from "@/domain";
// LAN HTTP pages do not expose crypto.randomUUID; getRandomValues remains available.
function requestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
const empty: StudioState = { schema: 1, activeId: "", projects: [] };
export function useStudio() {
  const [state, setState] = useState(empty),
    [files, setFiles] = useState<Record<string, MediaFile[]>>({});
  const [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState("");
  const pendingMessage = useRef<{ key: string; id: string } | null>(null);
  const attachmentIds = useRef(new WeakMap<File, string>());
  const importRequest = useRef(requestId());
  const active = useRef(""),
    locked = useRef(false),
    generation = useRef(0);
  const sync = useRef<ReturnType<typeof createSnapshotSync> | null>(null);
  if (!sync.current) sync.current = createSnapshotSync();
  const working = useRef(false);
  const appliedSnapshot = useRef<unknown>(null);
  const refresh = useCallback(async (force = false) => {
    const ticket = ++generation.current;
    const data = await sync.current!.load(force);
    if (ticket !== generation.current) return;
    setConnectionError("");
    if (data === null || data === appliedSnapshot.current) return;
    appliedSnapshot.current = data;
    working.current = data.state.projects.some((p: StudioProject) => {
      if (["queued", "running"].includes(p.run?.status ?? "")) return true;
      const latest = new Map<string, string>();
      for (const m of p.messages)
        if (m.taskId && m.execution) latest.set(m.taskId, m.execution.status);
      return [...latest].some(
        ([id, status]) =>
          p.tasks[id] &&
          p.tasks[id].delivery !== "approved" &&
          !p.tasks[id].retirement &&
          ["working", "reviewing", "revising"].includes(status),
      );
    });
    if (
      !data.state.projects.some((p: StudioProject) => p.id === active.current)
    )
      active.current = data.state.activeId;
    setState({ ...data.state, activeId: active.current });
    setFiles(data.files);
    setLoaded(true);
  }, []);
  useEffect(() => {
    active.current = localStorage.getItem("studio-active-project") ?? "";
    let alive = true,
      failures = 0,
      polling = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!alive || polling) return;
      clearTimeout(timer);
      polling = true;
      try {
        if (!document.hidden && !locked.current) {
          await refresh();
          failures = 0;
        }
      } catch (e) {
        failures++;
        if (alive)
          setConnectionError(
            e instanceof StudioConnectionError
              ? "连接暂时中断，正在重新同步；已发送的消息不受影响"
              : e instanceof Error
                ? e.message
                : "同步失败",
          );
      } finally {
        polling = false;
        if (alive)
          timer = setTimeout(poll, pollDelay(failures, working.current));
      }
    };
    const resume = () => {
      if (!document.hidden) void poll();
    };
    void poll();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      clearTimeout(timer);
      generation.current++;
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);
  async function send(body: FormData | object) {
    if (locked.current) return false;
    locked.current = true;
    setSaving(true);
    setError("");
    setConnectionError("");
    const isMessage =
      body instanceof FormData
        ? body.get("type") === "message"
        : "type" in body && body.type === "message" && "requestId" in body;
    try {
      const multipart = body instanceof FormData;
      const data = await studioJson(
        "/api/studio",
        {
          method: "POST",
          headers: multipart
            ? undefined
            : { "Content-Type": "application/json" },
          body: multipart ? body : JSON.stringify(body),
        },
        { retryUncertain: isMessage },
      );
      if (data.projectId) active.current = data.projectId;
      await refresh(true).catch(() =>
        setConnectionError("操作已保存，页面暂未同步，正在重新连接"),
      );
      return true;
    } catch (e) {
      setError(
        e instanceof StudioConnectionError
          ? isMessage
            ? "暂时无法确认消息是否送达，输入已保留。连接恢复后可重试，系统会避免重复发送"
            : "网络连接中断，操作结果暂未确认，请先查看最新状态"
          : e instanceof Error
            ? e.message
            : "保存失败",
      );
      await refresh(true).catch(() => {});
      return false;
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  const select = (id: string) => {
    active.current = id;
    localStorage.setItem("studio-active-project", id);
    setState((s) => ({ ...s, activeId: id }));
  };
  const create = (name: string, message: string, files: File[]) => {
    const form = new FormData();
    form.set("type", "create");
    form.set("requestId", importRequest.current);
    form.set("name", name);
    form.set("message", message);
    files.forEach((f) => form.append("files", f));
    return send(form).then((ok) => {
      if (ok) importRequest.current = requestId();
      return ok;
    });
  };
  const act = (p: StudioProject, id: string, action: TaskAction, reason = "") =>
    send({
      type: "action",
      projectId: p.id,
      version: p.version,
      taskId: id,
      revision: p.tasks[id].revision,
      action,
      reason,
    });
  const upload = (p: StudioProject, id: string, files: File[]) => {
    const f = new FormData();
    f.set("type", "upload");
    f.set("projectId", p.id);
    f.set("taskId", id);
    f.set("version", String(p.version));
    f.set("revision", String(p.tasks[id].revision));
    files.forEach((file) => f.append("files", file));
    return send(f);
  };
  const message = async (
    p: string,
    text: string,
    replyToId?: string,
    imageRevision?: number,
    images: File[] = [],
  ) => {
    const key =
      p +
      "\n" +
      text +
      "\n" +
      (replyToId ?? "") +
      ":" +
      (imageRevision ?? "") +
      JSON.stringify(
        images.map((file) => {
          if (!attachmentIds.current.has(file))
            attachmentIds.current.set(file, requestId());
          return attachmentIds.current.get(file);
        }),
      );
    if (pendingMessage.current?.key !== key)
      pendingMessage.current = { key, id: requestId() };
    const body = {
      type: "message",
      projectId: p,
      text,
      replyToId,
      imageRevision,
      requestId: pendingMessage.current.id,
    };
    const form = new FormData();
    if (images.length) {
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined) form.set(key, String(value));
      });
      images.forEach((file) => form.append("files", file));
    }
    const ok = await send(images.length ? form : body);
    if (ok) pendingMessage.current = null;
    return ok;
  };
  const confirm = (p: string, planId: string) =>
    send({ type: "confirm-plan", projectId: p, planId });
  return {
    state,
    files,
    loaded,
    saving,
    error: error || connectionError,
    setError: (message: string) => {
      setError(message);
      if (!message) setConnectionError("");
    },
    select,
    create,
    act,
    upload,
    message,
    skipConfirmation: (projectId: string, messageId: string) =>
      send({ type: "skip-confirmation", projectId, messageId }),
    recycleImage: (
      projectId: string,
      fileId: string,
      action: "trash" | "restore",
      reason: string,
    ) => send({ type: "recycle-image", projectId, fileId, action, reason }),
    confirm,
  };
}
