"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RecordData } from "@/client/api";
import { createImportKey } from "@/shared/story-import";
import type { OpenaiSettingsValue } from "./openai-settings";

export function useAiChat(
  p: string,
  sessionId: string,
  refresh: () => Promise<void>,
  fail: (error: unknown) => void,
) {
  const [settings, setSettings] = useState<OpenaiSettingsValue | null>(null);
  const [turns, setTurns] = useState<RecordData[]>([]);
  const [sending, setSending] = useState(false);
  const refs = useRef({ refresh, fail });
  refs.current = { refresh, fail };
  const lastState = useRef("");
  const request = useRef<{
    signature: string;
    key: string;
    uploadKey: string;
  } | null>(null);
  const loadSettings = useCallback(async () => {
    setSettings(await api<OpenaiSettingsValue>("/openai"));
  }, []);
  const loadTurns = useCallback(async () => {
    const next = await api<RecordData[]>(
      `/projects/${p}/sessions/${sessionId}/turns`,
    );
    setTurns(next);
    const marker = JSON.stringify(next.map((t) => [t.id, t.status]));
    if (
      (lastState.current && lastState.current !== marker) ||
      next.some((t) => t.status === "running" || t.status === "queued")
    )
      await refs.current.refresh();
    lastState.current = marker;
    return next;
  }, [p, sessionId]);
  useEffect(() => {
    void loadSettings().catch((e) => refs.current.fail(e));
  }, [loadSettings]);
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let active = false;
      try {
        if (document.visibilityState === "visible") {
          const rows = await loadTurns();
          active = rows.some(
            (t) => t.status === "running" || t.status === "queued",
          );
        }
      } catch {
        /* Brief disconnects must not replace drafts or discard an active turn. */
      }
      if (!disposed) timer = setTimeout(poll, active ? 2000 : 8000);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [loadTurns]);
  const running = turns.some(
    (t) => t.status === "queued" || t.status === "running",
  );
  async function send(
    content: string,
    files: File[],
    quoteId: string,
    messageId?: string,
  ) {
    const signature = JSON.stringify([
      content,
      quoteId,
      messageId,
      files.map((f) => [f.name, f.size, f.lastModified]),
    ]);
    if (request.current?.signature !== signature)
      request.current = {
        signature,
        key: createImportKey(),
        uploadKey: createImportKey(),
      };
    setSending(true);
    try {
      let storyIds: string[] = [];
      if (files.length) {
        const form = new FormData();
        form.set("source", "files");
        form.set("importKey", request.current.uploadKey);
        files.forEach((f) => form.append("file", f));
        const uploaded = await api<{ stories: RecordData[] }>(
          `/projects/${p}/stories`,
          { method: "POST", body: form },
        );
        storyIds = uploaded.stories.map((s) => String(s.id));
      }
      await api(`/projects/${p}/sessions/${sessionId}/turns`, {
        method: "POST",
        body: JSON.stringify(
          messageId
            ? { requestKey: request.current.key, messageId }
            : {
                requestKey: request.current.key,
                content,
                storyIds,
                ...(quoteId ? { quoteId } : {}),
              },
        ),
      });
      request.current = null;
      // From this point the message is committed: refresh failures must not encourage resending.
      await loadTurns().catch(() => {});
      await refs.current.refresh().catch(() => {});
      return true;
    } catch (e) {
      refs.current.fail(e);
      return false;
    } finally {
      setSending(false);
    }
  }
  return { settings, loadSettings, turns, running, sending, send };
}
