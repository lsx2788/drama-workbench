import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migration } from "./migration";
import { initializeStoryPreferences } from "./story-preference-catalog";
import { migrateCoordinatorIntake } from "./coordinator-intake";
import { migrateStoryBatches } from "./story-batch-migration";
import { migrateAgentPrompts } from "./agent-prompt-migration";
import { migrateCoordinatorReading } from "./coordinator-reading";
import { migrateCoordinatorFormat } from "./coordinator-format";
import { migrateChildCollaboration } from "./child-collaboration-migration";
import { migrateCoordinatorHandoff } from "./coordinator-handoff-migration";
import { migrateAgentConfigLayers } from "./agent-config-migration";
import { migratePreparation } from "./preparation-migration";
import { migrateAiRuntime } from "./ai-migration";
import { migrateCodex } from "./codex-migration";
import { migrateGroups } from "./group-migration";
import { migrateDynamicCollaboration } from "./dynamic-collaboration-migration";

export type Row = Record<string, unknown>;
export class Store {
  private transactionDepth = 0;
  readonly db: DatabaseSync;
  readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
    mkdirSync(path.join(this.root, "files"), { recursive: true });
    this.db = new DatabaseSync(path.join(this.root, "workbench.sqlite"));
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(migration);
    initializeStoryPreferences(this);
    migrateCoordinatorIntake(this);
    migrateStoryBatches(this);
    migrateAgentPrompts(this);
    migrateCoordinatorReading(this);
    migrateCoordinatorFormat(this);
    migrateChildCollaboration(this);
    migrateCoordinatorHandoff(this);
    migrateAgentConfigLayers(this);
    migratePreparation(this);
    migrateAiRuntime(this);
    migrateCodex(this);
    migrateGroups(this);
    migrateDynamicCollaboration(this);
  }
  all(sql: string, ...args: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...args) as Row[];
  }
  one(sql: string, ...args: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...args) as Row | undefined;
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    const savepoint = `nested_${depth}`;
    this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      this.db.exec(
        depth === 0 ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${savepoint}`,
      );
      if (depth > 0) this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  close() {
    this.db.close();
  }
}
const globals = globalThis as typeof globalThis & { workbenchStore?: Store };
export function getStore() {
  return (globals.workbenchStore ??= new Store(
    process.env.DATA_DIR || "./data",
  ));
}
