"use client";
import { useState } from "react";
import { str, type RecordData } from "@/client/api";
import { NodeDetails } from "./node-details";
import { PromptDialog } from "./prompt-dialog";
import { CreateForm, type FormKind } from "./create-form";
import type { ChatViewProps } from "./view-types";

export function FlowNodeDialog({
  current,
  onClose,
  ...props
}: ChatViewProps & {
  current: RecordData;
  onClose: () => void;
}) {
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<{
    kind: FormKind;
    defaults?: Record<string, string>;
  } | null>(null);
  return (
    <PromptDialog
      title={str(current, "name")}
      onClose={onClose}
      closeLabel="关闭节点详情"
    >
      {error && <p role="alert">{error}</p>}
      <NodeDetails
        {...props}
        current={current}
        sessionId={sessionId}
        onSelect={setSessionId}
        create={(kind, defaults) => setForm({ kind, defaults })}
        fail={(error) =>
          setError(error instanceof Error ? error.message : "操作失败")
        }
      />
      {form && (
        <CreateForm
          kind={form.kind}
          defaults={form.defaults}
          workspace={props.w}
          projectId={props.p}
          onClose={() => setForm(null)}
          onSaved={async (result) => {
            await props.refresh();
            const saved = result as RecordData;
            if (form.kind === "session") setSessionId(str(saved, "id"));
            if (form.kind === "story")
              setSessionId(String((saved.discussion as RecordData).sessionId));
            setForm(null);
          }}
        />
      )}
    </PromptDialog>
  );
}
