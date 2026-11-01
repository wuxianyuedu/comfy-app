import { describe, expect, it, vi } from "vitest";

import { type SqliteBusyRetryPolicy, runWithSqliteBusyRetry } from "./sqlite-busy-retry";

/* 预算取 0 毫秒：本文件判的是**循环形状**（试几次、什么算可重试、抛出的是不是
 * 原对象），退避算法本身由 `retry-policy` 自己的用例负责，这里不重判它。 */
const POLICY: SqliteBusyRetryPolicy = {
  shape: "exponential",
  baseMs: 0,
  maxMs: 0,
  maxAttempts: 3,
};

/** drizzle 的真实包法：驱动错误挂在 `cause` 上（同 `sqlite-error.test.ts`）。 */
function busy(overrides?: Record<string, unknown>): Error {
  const e = new Error("Failed query: begin");
  /* SAFETY: 类型断言已复核 */ (e as { cause?: unknown }).cause = {
    code: "SQLITE_BUSY",
    message: "database is locked",
    ...overrides,
  };
  return e;
}

describe("runWithSqliteBusyRetry", () => {
  it("首次就成 ⇒ 一次也不重试，也不念 onBusy", async () => {
    const onBusy = vi.fn();
    const op = vi.fn(async () => "ok");
    await expect(runWithSqliteBusyRetry(op, { policy: POLICY, onBusy })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(onBusy).not.toHaveBeenCalled();
  });

  it("撞锁两次后成功 ⇒ 共三次，onBusy 收到 attempt 0 与 1", async () => {
    const seen: Array<number> = [];
    let calls = 0;
    const result = await runWithSqliteBusyRetry(
      async () => {
        calls += 1;
        if (calls <= 2) {
          throw busy();
        }
        return calls;
      },
      // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
      { policy: POLICY, onBusy: (attempt) => void seen.push(attempt) },
    );
    expect(result).toBe(3);
    expect(seen).toEqual([0, 1]);
  });

  it("非锁族错误 ⇒ 只试一次、原样抛出、onGiveUp 收到 tries=1", async () => {
    const boom = new Error('no such table: "remoteModel"');
    const op = vi.fn(async () => {
      throw boom;
    });
    const onGiveUp = vi.fn();
    await expect(runWithSqliteBusyRetry(op, { policy: POLICY, onGiveUp })).rejects.toBe(boom);
    expect(op).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp.mock.calls[0]?.[1]).toBe(1);
  });

  it("撞锁穷尽 ⇒ 试满 maxAttempts，抛出的是**原对象**（不许在这里改写文案）", async () => {
    const boom = busy();
    const op = vi.fn(async () => {
      throw boom;
    });
    const onGiveUp = vi.fn();
    await expect(runWithSqliteBusyRetry(op, { policy: POLICY, onGiveUp })).rejects.toBe(boom);
    expect(op).toHaveBeenCalledTimes(POLICY.maxAttempts);
    expect(onGiveUp.mock.calls[0]?.[1]).toBe(POLICY.maxAttempts);
  });

  it("maxAttempts=1 时撞锁也不重试（预算就是「让路」而不是「等」）", async () => {
    const boom = busy();
    const op = vi.fn(async () => {
      throw boom;
    });
    await expect(
      runWithSqliteBusyRetry(op, { policy: { ...POLICY, maxAttempts: 1 } }),
    ).rejects.toBe(boom);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("消息形态的那种锁（没有 code、只有 database is locked）也算可重试", async () => {
    const phraseOnly = new Error("Failed query: begin");
    /* SAFETY: 类型断言已复核 */ (phraseOnly as { cause?: unknown }).cause = new Error(
      "database is locked",
    );
    let calls = 0;
    await expect(
      runWithSqliteBusyRetry(
        async () => {
          calls += 1;
          if (calls === 1) {
            throw phraseOnly;
          }
          return calls;
        },
        { policy: POLICY },
      ),
    ).resolves.toBe(2);
  });

  it("onBusy 里抛错 ⇒ 盖掉原错误向外传（这是继承来的形状，不是这里新定的）", async () => {
    // 既有两处站点就是在 catch 里直接调 `log(...)`，日志通道自己炸时抛出的就是
    // 那个新错误而不是库的错误。这里保持同形并把代价写明白：**回调只许念话**，
    // 往里塞会抛的逻辑就是把判决盖掉。
    const boom = busy();
    const op = vi.fn(async () => {
      throw boom;
    });
    const logBoom = new Error("日志通道自己炸了");
    await expect(
      runWithSqliteBusyRetry(op, {
        policy: { ...POLICY, maxAttempts: 2 },
        onBusy: () => {
          throw logBoom;
        },
      }),
    ).rejects.toBe(logBoom);
    expect(op).toHaveBeenCalledTimes(1);
  });
});
