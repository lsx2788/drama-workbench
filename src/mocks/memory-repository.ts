import type { StudioState } from "@/domain";
import type {
  FileChange,
  WorkspaceRepository,
  WorkspaceSnapshot,
} from "@/application/repository";

/** Fresh instance per preview/test. No browser, HTTP or database required. */
export function createMemoryRepository(): WorkspaceRepository {
  let snapshot: WorkspaceSnapshot | null = null;
  const copy = (value: WorkspaceSnapshot): WorkspaceSnapshot => ({
    state: structuredClone(value.state),
    files: Object.fromEntries(
      Object.entries(value.files).map(([key, files]) => [key, [...files]]),
    ),
  });
  return {
    async load() {
      return snapshot ? copy(snapshot) : null;
    },
    async save(state: StudioState, change?: FileChange) {
      snapshot = copy({
        state,
        files: {
          ...snapshot?.files,
          ...(change ? { [change.key]: change.files } : {}),
        },
      });
    },
  };
}
