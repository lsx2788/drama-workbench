import type { StudioState } from "@/domain";

/** Mock persistence boundary; not a database schema or a model-provider API. */
export type WorkspaceSnapshot = {
  state: StudioState;
  files: Record<string, File[]>;
};
export type FileChange = { key: string; files: File[] };
export interface WorkspaceRepository {
  load(): Promise<WorkspaceSnapshot | null>;
  save(state: StudioState, fileChange?: FileChange): Promise<void>;
}
