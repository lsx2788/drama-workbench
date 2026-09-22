import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareCodexHome } from "../src/server/ai/codex-home";

test("backend keeps durable history separate and migrates only its requested session once", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "studio-codex-home-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, "desktop"),
    workspace = path.join(root, "data", "ai-workspace");
  mkdirSync(path.join(desktop, "archived_sessions"), { recursive: true });
  writeFileSync(path.join(desktop, "auth.json"), "test-only-login-placeholder");
  const id = "11111111-1111-4111-8111-111111111111";
  const file = `rollout-test-${id}.jsonl`;
  const original = path.join(desktop, "archived_sessions", file);
  writeFileSync(original, "original session");
  writeFileSync(
    path.join(desktop, "archived_sessions", "unrelated.jsonl"),
    "unrelated",
  );
  const home = prepareCodexHome(workspace, id, desktop);
  assert.notEqual(home, desktop);
  assert.equal(lstatSync(path.join(home, "auth.json")).isSymbolicLink(), true);
  assert.equal(
    realpathSync(path.join(home, "auth.json")),
    realpathSync(path.join(desktop, "auth.json")),
  );
  const migrated = path.join(home, "sessions", file);
  assert.equal(readFileSync(migrated, "utf8"), "original session");
  assert.equal(
    existsSync(path.join(home, "sessions", "unrelated.jsonl")),
    false,
  );
  writeFileSync(migrated, "continued in backend");
  prepareCodexHome(workspace, id, desktop);
  assert.equal(readFileSync(migrated, "utf8"), "continued in backend");
  assert.equal(readFileSync(original, "utf8"), "original session");
  assert.throws(
    () => prepareCodexHome(workspace, "../../other", desktop),
    /无效/,
  );
});

test("missing login fails without inventing credentials or falling back to the desktop store", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "studio-codex-home-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () =>
      prepareCodexHome(
        path.join(root, "data", "ai-workspace"),
        undefined,
        path.join(root, "desktop"),
      ),
    /登录/,
  );
  assert.equal(
    existsSync(path.join(root, "data", "codex-runtime", "auth.json")),
    false,
  );
});
