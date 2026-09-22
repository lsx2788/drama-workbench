import {
  copyFileSync,
  existsSync,
  globSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Keep durable backend sessions out of the desktop's session directory. */
export function prepareCodexHome(
  workspace: string,
  threadId?: string,
  desktopHome = process.env.CODEX_HOME ||
    path.join(/* turbopackIgnore: true */ homedir(), ".codex"),
) {
  const home = path.resolve(
    /* turbopackIgnore: true */ workspace,
    "..",
    "codex-runtime",
  );
  mkdirSync(home, { recursive: true });
  const auth = path.join(/* turbopackIgnore: true */ desktopHome, "auth.json");
  const linked = path.join(/* turbopackIgnore: true */ home, "auth.json");
  // Let Codex read its existing login itself; never read or copy token contents.
  if (!existsSync(/* turbopackIgnore: true */ auth))
    throw new Error("请先在本机 Codex 登录 ChatGPT 账户");
  if (!existsSync(/* turbopackIgnore: true */ linked))
    symlinkSync(path.resolve(/* turbopackIgnore: true */ auth), linked, "file");
  else if (
    !lstatSync(/* turbopackIgnore: true */ linked).isSymbolicLink() ||
    realpathSync(/* turbopackIgnore: true */ linked) !==
      realpathSync(/* turbopackIgnore: true */ auth)
  )
    throw new Error("后台登录引用与本机 Codex 不一致，请检查后台会话目录");

  if (threadId) {
    if (!/^[0-9a-f-]{36}$/i.test(threadId))
      throw new Error("无效的后台会话编号");
    const pattern = `**/*${threadId}.jsonl`;
    const hasCopy = ["sessions", "archived_sessions"].some((dir) => {
      const root = path.join(/* turbopackIgnore: true */ home, dir);
      return (
        existsSync(/* turbopackIgnore: true */ root) &&
        globSync(pattern, { cwd: root }).length > 0
      );
    });
    if (!hasCopy) {
      for (const dir of ["sessions", "archived_sessions"]) {
        const root = path.join(/* turbopackIgnore: true */ desktopHome, dir);
        if (!existsSync(/* turbopackIgnore: true */ root)) continue;
        const file = globSync(pattern, { cwd: root })[0];
        if (!file) continue;
        // Copy only this app's requested session. Original remains recoverable.
        const target = path.join(
          /* turbopackIgnore: true */ home,
          "sessions",
          file,
        );
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(
          /* turbopackIgnore: true */ path.join(
            /* turbopackIgnore: true */ root,
            file,
          ),
          target,
        );
        break;
      }
    }
  }
  return home;
}
