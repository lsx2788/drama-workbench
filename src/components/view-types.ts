import type { FormKind } from "./create-form";
import type { Workspace } from "@/client/api";
export type CreateAction = (
  kind: FormKind,
  defaults?: Record<string, string>,
) => void;
export interface ChatViewProps {
  w: Workspace;
  p: string;
  create: CreateAction;
  refresh: () => Promise<void>;
  fail: (error: unknown) => void;
  sessionId: string;
  quoteId: string;
  onSelect: (sessionId: string) => void;
  onQuote: (messageId: string) => void;
  onClearQuote: () => void;
}
