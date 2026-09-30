import { describe, expect, it } from "vitest";

import { describeSqliteWriteError, isSqliteBusyError } from "./sqlite-error";

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
