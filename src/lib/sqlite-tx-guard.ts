/**
 * `sqlite-tx-guard.ts` -- machine-enforced transaction isolation for the
 * single-connection node:sqlite driver (ISSUE #4734 / ISSUE #3850).
 *
 * Why: drizzle's sqlite-proxy transactions do not queue. The whole transaction
 * (BEGIN -> callback -> COMMIT) runs on the one synchronous connection of the
 * process, so atomicity holds only while every `await` inside the transaction
 * callback stays at microtask level (pure DB statements). One real async
 * (fetch / timer / LLM call) inside the callback yields across macrotasks and
 * lets any other request's statements interleave into the open transaction:
 * they read uncommitted rows, get committed by someone else's COMMIT, or blow
 * up with "cannot start a transaction within a transaction".
 *
 * The guard makes the invariant mechanical instead of disciplinary:
 *
 *  - `trackTxLifecycle()` records BEGIN / COMMIT / ROLLBACK at the proxy level
 *    (a transaction is open between the first and the last of those).
 *  - `guardStatement()` rejects any non-lifecycle statement that arrives while
 *    a transaction is open UNLESS it is issued from inside that transaction's
 *    async chain (AsyncLocalStorage scope installed by `runTxCallback`).
 *  - `withSqliteTxGuard()` wraps a drizzle instance so `.transaction()`
 *    callbacks run inside that scope.
 *
 * Statements created inside the callback (including timers) keep the scope and
 * stay legal; anything else interleaving into the open transaction throws a
 * loud, actionable error instead of silently corrupting data. Keep this file
 * ASCII-only: it sits on the build-time module graph via `sqlite-pragmas.ts`
 * (AGENTS.md hard rule 16 / launch-and-build sec.5).
 *
 * @module lib/sqlite-tx-guard
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type * as schema from "~/server/db/schema";

type TxGuardState = {
  /** Identity of the currently open transaction (presence = one is open). */
  openTxToken: number | null;
  /** Scope marker propagated through the transaction callback's await chain. */
  txScope: AsyncLocalStorage<{ readonly token: number }>;
};

declare global {
  // Ambient singleton, same shape as `db` / `__comfyNodeSqlite` in server/db.ts.
  var __comfySqliteTxGuard: TxGuardState | undefined;
}

/* The production build inlines this module into several server chunks (run
 * 45079350257 shipped 7 copies), and each copy closes over its own state.
 * `withSqliteTxGuard` then installs the callback scope in one copy while the
 * driver's `guardStatement` reads another, so every statement inside any
 * transaction is rejected as "outside its async chain" (e2e main-journey went
 * red on the production build only). Keep the state on a globalThis singleton
 * -- same pattern as `db` / `__comfyNodeSqlite` / `filmWatchInFlight_v1` --
 * so every module copy shares one ledger. */
const globalTxGuard = (globalThis.__comfySqliteTxGuard ??= {
  openTxToken: null,
  txScope: new AsyncLocalStorage<{ readonly token: number }>(),
});

function isTxLifecycleSql(sql: string): boolean {
  const upper = sql.trimStart().toUpperCase();
  return (
    upper.startsWith("BEGIN") ||
    upper.startsWith("COMMIT") ||
    upper.startsWith("ROLLBACK") ||
    upper.startsWith("SAVEPOINT") ||
    upper.startsWith("RELEASE")
  );
}

/** Proxy-level bookkeeping: call for every statement before it executes. */
export function trackTxLifecycle(sql: string): void {
  if (!isTxLifecycleSql(sql)) {
    return;
  }
  const upper = sql.trimStart().toUpperCase();
  if (upper.startsWith("BEGIN")) {
    if (globalTxGuard.openTxToken !== null) {
      throw new Error(
        "[sqlite-tx-guard] BEGIN while another transaction is open (nested transaction).",
      );
    }
    globalTxGuard.openTxToken = 1;
    return;
  }
  if (upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) {
    globalTxGuard.openTxToken = null;
  }
}

/** Proxy-level guard: refuse statements that would interleave into an open
 *  transaction from outside its async chain. */
export function guardStatement(sql: string): void {
  if (isTxLifecycleSql(sql) || globalTxGuard.openTxToken === null) {
    return;
  }
  if (globalTxGuard.txScope.getStore() !== undefined) {
    return;
  }
  throw new Error(
    "[sqlite-tx-guard] A statement tried to run inside an open transaction from outside " +
      "its async chain. The transaction callback must only await DB statements; real async " +
      "(fetch / timers / external calls) lets other requests interleave into the uncommitted " +
      "transaction. See lib-layer standards 18.10.2.",
  );
}

/** Run a transaction callback inside its statement scope. */
export function runTxCallback<T>(callback: () => Promise<T>): Promise<T> {
  return globalTxGuard.txScope.run({ token: globalTxGuard.openTxToken ?? 0 }, callback);
}

/** The drizzle instances this wrapper covers (both use the same schema). */
export type GuardedSqliteDb = SqliteRemoteDatabase<typeof schema>;

/** Wrap a drizzle instance so `.transaction()` callbacks run inside the guard
 *  scope. Only `transaction` is shadowed; everything else passes through the
 *  prototype chain unchanged. */
export function withSqliteTxGuard(db: GuardedSqliteDb): GuardedSqliteDb {
  const original = db.transaction.bind(db);
  const wrapped = (
    callback: Parameters<typeof original>[0],
    config?: Parameters<typeof original>[1],
  ): Promise<unknown> => original((tx) => runTxCallback(() => callback(tx)), config);
  /* 原地定义（类型层面仍是原型上的泛型签名，调用点零改动）；实例是 globalThis
   * 单例，重复包一层（热重载）只是多套一层作用域，语义不变。 */
  Object.defineProperty(db, "transaction", {
    value: wrapped,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return db;
}
