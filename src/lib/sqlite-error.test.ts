import { describe, expect, it } from "vitest";

import { LOG_DETAIL_MAX } from "~/lib/text-clamp";
import {
  describeSqliteWriteError,
  isSqliteBusyError,
  sqliteAwareErrorText,
} from "./sqlite-error";

/* 这两条判据的形状照 drizzle 的真实包法写：drizzle 把驱动错误放在 `cause` 上，
 * 自己的 message 只有 `Failed query: <sql>\nparams: <…>`。#1250 的现场就是日志里
 * 只有那一句，看不出原因是「锁」还是「没表」。 */
function drizzleWrapped(cause: unknown): Error {
  const e = new Error(
    'Failed query: update "task" set "status" = ? where "task"."id" = ?\nparams: FAILED,t1',
  );
  (e as { cause?: unknown }).cause = cause;
  return e;
}

describe("describeSqliteWriteError", () => {
  it("把 cause 上的错误码与消息拼回同一句", () => {
    const text = describeSqliteWriteError(
      drizzleWrapped({ code: "SQLITE_BUSY", message: "database is locked" }),
      "终态失败收口写库失败",
    );
    expect(text).toContain("Failed query");
    expect(text).toContain("SQLITE_BUSY");
    expect(text).toContain("database is locked");
  });

  it("cause 只有一层以上也能取到（沿链走，不只看 e.cause）", () => {
    const text = describeSqliteWriteError(
      drizzleWrapped({
        message: "driver 层",
        cause: { code: "SQLITE_LOCKED", message: "table is locked" },
      }),
      "f",
    );
    expect(text).toContain("SQLITE_LOCKED");
    expect(text).toContain("driver 层");
  });

  it("没有 cause 时退回原消息；原消息为空才用 fallback", () => {
    expect(
      describeSqliteWriteError(new Error("no such table: task"), "f"),
    ).toBe("no such table: task");
    expect(describeSqliteWriteError(new Error(""), "收口写失败")).toContain(
      "收口写失败",
    );
    /* 抛值可以是任何东西 —— 这条链不能因为拿到 string / null 就抛。 */
    expect(() => describeSqliteWriteError("boom", "f")).not.toThrow();
    expect(() => describeSqliteWriteError(null, "f")).not.toThrow();
  });

  it("cause 自引用时不会把进程吊死（有层数上限）", () => {
    const a: { message: string; cause?: unknown } = { message: "A" };
    const b: { message: string; cause?: unknown } = { message: "B", cause: a };
    a.cause = b;
    expect(() => describeSqliteWriteError(a, "f")).not.toThrow();
    expect(isSqliteBusyError(a)).toBe(false);
  });
  it("head 再长也不许把原因挤掉（预算先给原因，再给现场细节）", () => {
    /* #1262 复演读数逼出来的顺序：drizzle 的 head 连着 `params:`，一次校验失败会把
     * 整段模型清单塞进参数里，实测 655 字那一行把 `（SQLite: SQLITE_BUSY…）` 挤成了省略号
     * —— 那一格「原因看得见」当场又失效了。原因必须是最后一个被牺牲的东西。 */
    const longParams = `Failed query: update "task" set "error" = ? params: 校验未通过 ${"某模型.safetensors, ".repeat(80)}`;
    const e = new Error(longParams);
    e.cause = { code: "SQLITE_BUSY", message: "database is locked" };
    const text = describeSqliteWriteError(e, "f");
    expect(text.length).toBeLessThanOrEqual(LOG_DETAIL_MAX);
    expect(text).toContain("SQLITE_BUSY");
    expect(text).toContain("database is locked");
    /* 被截的是现场细节，不是原因。 */
    expect(text).toContain("…（SQLite: SQLITE_BUSY");
  });
});

describe("sqliteAwareErrorText —— 库写失败的捕获点都要看得见原因（ISSUE #1262 的前置）", () => {
  it("是库失败且 cause 带码：一句里同时有动作前缀、drizzle 的原文与驱动码", () => {
    const text = sqliteAwareErrorText(
      drizzleWrapped({ code: "SQLITE_BUSY", message: "database is locked" }),
      "领取队列任务失败",
    );
    /* 前缀必须在：同一块面板上「哪个动作失败了」永远要看得见（与 errorText 同规则）。 */
    expect(text.startsWith("领取队列任务失败：")).toBe(true);
    expect(text).toContain("Failed query");
    expect(text).toContain("SQLITE_BUSY");
  });

  it("是库失败但 cause 链上一个码都没有：**明说**取不到，不留空白", () => {
    /* 这一刻正是最容易被误读的时刻 —— 空白会被读成「没有原因」，而真实情况是
     * 「原因在链路里丢了」。#1262 第一次读数读不出谁扣的锁，缺的就是这一句。 */
    const text = sqliteAwareErrorText(
      drizzleWrapped(undefined),
      "领取队列任务失败",
    );
    expect(text).toContain("Failed query");
    expect(text).toContain("原因未取到");
  });

  it("不是库失败：原样交给 errorText，网络错的翻译本领一条不丢", () => {
    expect(sqliteAwareErrorText(new Error("fetch failed"), "f")).toContain(
      "连接被拒绝或中断",
    );
    expect(sqliteAwareErrorText(new Error(""), "续跑出队失败")).toContain(
      "续跑出队失败",
    );
  });

  it("「没表」也是库失败（照样带原因），但它仍然判不可重试", () => {
    const err = drizzleWrapped({
      code: "SQLITE_ERROR",
      message: "no such table: task",
    });
    expect(sqliteAwareErrorText(err, "f")).toContain("no such table");
    /* 两条判据各管各的：可见性把码带出来，重试判定依然只认锁族 ——
     * 别因为「现在能看见原因了」就把后者当成前者的一部分放宽掉。 */
    expect(isSqliteBusyError(err)).toBe(false);
  });

  it("抛值是 string / null / undefined 都不炸，一律回落成「动作：兜底详情」", () => {
    for (const value of ["boom", null, undefined, 42]) {
      expect(() => sqliteAwareErrorText(value, "收口写失败")).not.toThrow();
    }
    /* 与 errorText 同规则：动作前缀永远在，兜底只补详情那一半。 */
    expect(sqliteAwareErrorText(null, "收口写失败")).toBe(
      "收口写失败：未知错误",
    );
  });
});

describe("isSqliteBusyError", () => {
  it("锁族错误码算可重试", () => {
    for (const code of ["SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_PROTOCOL"]) {
      expect(isSqliteBusyError(drizzleWrapped({ code }))).toBe(true);
    }
  });

  it("个别驱动只在 message 里给原因，也算", () => {
    expect(isSqliteBusyError({ message: "database is locked" })).toBe(true);
    expect(
      isSqliteBusyError({ message: "SQLITE_BUSY: too many attached" }),
    ).toBe(true);
  });

  it("认不出原因就不重试：真故障不该被拖成四次同样的写入", () => {
    expect(
      isSqliteBusyError(
        drizzleWrapped({
          code: "SQLITE_ERROR",
          message: "no such table: task",
        }),
      ),
    ).toBe(false);
    expect(isSqliteBusyError(new Error("abort"))).toBe(false);
    expect(isSqliteBusyError(undefined)).toBe(false);
    expect(isSqliteBusyError(42)).toBe(false);
  });
});
