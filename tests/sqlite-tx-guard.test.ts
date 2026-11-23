/** `sqlite-tx-guard` 的机器判据（ISSUE #4734 / #3850）：
 *  ① 纯 DB await 的事务照常工作；② 事务回调里混入真实异步后，其它请求的
 *  语句插进打开事务会被守卫当场拒绝（而不是静默读未提交数据）。 */
import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";

import { isRecord } from "~/lib/is-record";
import { openNodeSqlite } from "~/lib/sqlite-driver";
import { withSqliteTxGuard } from "~/lib/sqlite-tx-guard";
import * as schema from "~/server/db/schema";

const handle = openNodeSqlite(":memory:");
handle.execute("CREATE TABLE guard_t (v INTEGER)");
const db = withSqliteTxGuard(drizzle(handle.proxy, { schema }));

function rowCount(): number {
  const row: unknown = handle.sqlite.prepare("select count(*) as c from guard_t").get();
  if (isRecord(row) && typeof row.c === "number") {
    return row.c;
  }
  throw new Error("guard_t 计数行缺失");
}

/** 拒绝原因核对：drizzle 包装层的 `cause` 里才是守卫原话。 */
function hasGuardCause(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.cause instanceof Error &&
    error.cause.message.includes("sqlite-tx-guard")
  );
}

describe("sqlite 事务隔离守卫", () => {
  it("纯 DB await 的事务照常工作（不变式的正例）", async () => {
    await db.transaction(async (tx) => {
      await tx.run(sql`insert into guard_t values (1)`);
      await tx.run(sql`insert into guard_t values (2)`);
    });
    expect(rowCount()).toBe(2);
  });

  it("事务回调混入真实异步时，外部语句插进打开事务被当场拒绝（#4734）", async () => {
    let markStarted: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const slow = db.transaction(async (tx) => {
      await tx.run(sql`insert into guard_t values (10)`);
      markStarted(); // BEGIN 已发、首条已落：事务窗口确认打开
      /* 真实异步：setTimeout(0) 也是宏任务 —— 事务在这里跨宏任务挂起，此刻
       * 外部语句若能插进来，读到的就是未提交数据（旧世界静默发生；守卫必须
       * 让它响亮地失败）。 */
      await new Promise((resolve) => setTimeout(resolve, 0));
      await tx.run(sql`insert into guard_t values (11)`);
    });
    await started;
    /* drizzle 把驱动错误包成 DrizzleQueryError：守卫的原话在 `cause` 上。 */
    const outside = db.run(sql`select 1`);
    await expect(outside).rejects.toSatisfy(hasGuardCause);
    await slow;
    /* 事务自身不受影响：两条都落了。 */
    expect(rowCount()).toBe(4);
  });

  it("模块被生产打包成多份时，各副本共享同一本事务账（#4863）", async () => {
    /* 生产构建把本模块内联进多个 chunk（ISSUE #4863 现场：7 份）。状态若留在
     * 模块级闭包里，`withSqliteTxGuard` 装作用域的副本与 driver 里
     * `guardStatement` 读的副本不是同一份 ⇒ 事务内语句全被误判。修法是把
     * 状态挂 globalThis 单例；这里用「两次求值出两份模块」复现当时的病灶。 */
    vi.resetModules();
    const first = await import("~/lib/sqlite-tx-guard");
    vi.resetModules();
    const second = await import("~/lib/sqlite-tx-guard");
    /* 前置断言：两份确实是不同的模块实例，否则本用例没在测「多副本」。 */
    expect(second.guardStatement).not.toBe(first.guardStatement);

    /* 副本 A 上打开事务（driver 的 trackTxLifecycle 落在 A），副本 B 的
     * guardStatement 必须看得到这笔打开的事务：外部语句当场被拒。 */
    first.trackTxLifecycle("BEGIN IMMEDIATE");
    expect(() => {
      second.guardStatement("update task set status = 'RUNNING'");
    }).toThrow(/sqlite-tx-guard/);

    /* 副本 B 装进作用域的事务回调，副本 A 的 guard 也认：事务内语句放行 ——
     * 这正是生产档红掉的那条链（finalizeSuccessWithImages 的事务写）。 */
    await expect(
      second.runTxCallback(() => {
        first.guardStatement("update task set status = 'SUCCEEDED'");
        return Promise.resolve("ok" as const);
      }),
    ).resolves.toBe("ok");

    first.trackTxLifecycle("COMMIT");
    /* 事务关账后，外部语句不再被拒。 */
    expect(() => {
      second.guardStatement("update task set status = 'RUNNING'");
    }).not.toThrow();
  });
});
