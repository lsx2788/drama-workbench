import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migration } from "./migration";

export type Row = Record<string, unknown>;
export class Store {
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
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
