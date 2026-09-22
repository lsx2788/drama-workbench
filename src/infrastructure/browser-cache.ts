import type { StudioState } from "@/domain";
import type {
  WorkspaceRepository,
  WorkspaceSnapshot,
} from "@/application/repository";

// Browser-only mock repository. No production API or server database is touched.
const CACHE = "yingxu-studio-mock-v1";
function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("workspace");
      request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("浏览器本地存储不可用，请允许此网站保存数据"));
  });
}
async function readCache(): Promise<WorkspaceSnapshot | null> {
  const db = await openCache();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["workspace", "files"], "readonly");
      const state = tx.objectStore("workspace").get("current");
      const keys = tx.objectStore("files").getAllKeys();
      const values = tx.objectStore("files").getAll();
      tx.oncomplete = () => {
        const value = state.result as StudioState | undefined;
        if (value && (value.schema !== 1 || !Array.isArray(value.projects))) {
          reject(
            new Error("预览数据版本不兼容，请使用原来的浏览器版本导出资料"),
          );
          return;
        }
        if (!value) {
          resolve(null);
          return;
        }
        resolve({
          state: value,
          files: Object.fromEntries(
            keys.result.map((key, i) => [
              String(key),
              values.result[i] as File[],
            ]),
          ),
        });
      };
      tx.onerror = () => reject(new Error("读取本地预览数据失败"));
    });
  } finally {
    db.close();
  }
}
async function writeCache(
  state: StudioState,
  fileChange?: { key: string; files: File[] },
): Promise<void> {
  const db = await openCache();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspace", "files"], "readwrite");
      tx.objectStore("workspace").put(state, "current");
      if (fileChange)
        tx.objectStore("files").put(fileChange.files, fileChange.key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(new Error("本地保存失败，可能是存储空间不足；本次修改未保存"));
    });
  } finally {
    db.close();
  }
}

export const browserRepository: WorkspaceRepository = {
  load: readCache,
  save: writeCache,
};
