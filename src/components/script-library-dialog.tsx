"use client";
import { LibraryPendingDialog } from "./library-pending-dialog";

export function ScriptLibraryDialog({ onClose }: { onClose: () => void }) {
  return <LibraryPendingDialog title="剧本库" onClose={onClose} />;
}
