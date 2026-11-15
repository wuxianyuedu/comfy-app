/**
 * sqlite-busy-retry 的缺省告警与循环边界（ISSUE #3954）。
 *
 * 锁族判据本体在 `sqlite-error` 那侧有自己的用例；这里锁三件事：
 * ① 撞锁按策略重试且**缺省就有一行 warn**（此前多数站点静默，排障无现场）；
 * ② 显式 `onBusy` 整体覆盖缺省（不双写）；
 * ③ 非锁族错误当场原样抛出，一次也不重试、一行也不落。
 */
import { describe, expect, it, vi } from "vitest";

import { logger } from "../src/lib/core/logger";
import { runWithSqliteBusyRetry } from "../src/lib/sqlite-busy-retry";

const busyError = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
const policy = { shape: "fixed" as const, baseMs: 1, maxAttempts: 3 };

describe("runWithSqliteBusyRetry：缺省告警（ISSUE #3954）", () => {
  it("撞锁重试成功：只落一行 warn，不逐次刷", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    let calls = 0;
    const out = await runWithSqliteBusyRetry(
      () => {
        calls += 1;
        return calls < 3 ? Promise.reject(busyError) : Promise.resolve("ok");
      },
      { policy },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("最多 3 次");
    warn.mockRestore();
  });

  it("显式 onBusy 整体覆盖缺省：不再落标准 warn", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const onBusy = vi.fn();
    await runWithSqliteBusyRetry(() => Promise.reject(busyError), { policy, onBusy }).catch(
      () => undefined,
    );
    /* 3 次尝试里前 2 次失败后各回调一次；穷尽后原样抛。 */
    expect(onBusy).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("非锁族错误当场原样抛出：一次也不重试、一行也不落", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const boom = new Error("no such table");
    await expect(runWithSqliteBusyRetry(() => Promise.reject(boom), { policy })).rejects.toBe(boom);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
