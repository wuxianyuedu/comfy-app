import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, sleep, withTimeout, withTimeoutResult } from "./with-timeout";

afterEach(() => {
  vi.useRealTimers();
});

/** 永不结算的 promise（测试「超时」这一侧的桩）。 */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* 永不 resolve / reject —— 正是「卡住」的形态。 */
  });
}

describe("withTimeout", () => {
  it("按时完成时给原结果", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("超时抛 TimeoutError（带 timeoutMs）", async () => {
    vi.useFakeTimers();
    const p = withTimeout(never(), 500, { label: "加载" });
    /* 先挂 no-op 拒绝处理器占住位（推进定时器到断言之间不许出现 unhandled rejection），
     * 断言本体在推进后 await —— 时序与旧的「先挂断言再推进」等价。 */
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });

  it("默认文案带量纲换算（秒）与 label", async () => {
    vi.useFakeTimers();
    const p = withTimeout(never(), 25_000, { label: "工作流加载" });
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(p).rejects.toThrow("工作流加载超时（25s）");
  });

  it("message 优先于 label 拼法", async () => {
    vi.useFakeTimers();
    const p = withTimeout(never(), 1000, { message: "自定义超时" });
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).rejects.toThrow("自定义超时");
  });

  it("成功路径会清掉定时器（不泄漏活动定时器）", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("失败路径也会清掉定时器", async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.reject(new Error("boom")), 60_000).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("超时路径清掉定时器", async () => {
    vi.useFakeTimers();
    const p = withTimeout(never(), 1000);
    const assertion = p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("超时时先调 onTimeout（用于杀子进程等收尾）", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const p = withTimeout(never(), 1000, { onTimeout });
    const assertion = p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("onTimeout 自己抛错也不顶替超时错误（结论仍是超时）", async () => {
    vi.useFakeTimers();
    const p = withTimeout(never(), 1000, {
      onTimeout: () => {
        throw new Error("钩子失败");
      },
    });
    /* 先挂 no-op 拒绝处理器占住位（推进定时器到断言之间不许出现 unhandled rejection），
     * 断言本体在推进后 await —— 时序与旧的「先挂断言再推进」等价。 */
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });

  it("底层晚到的结果被丢弃、不触发 onTimeout", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let resolveLate!: (v: string) => void;
    const p = withTimeout(
      new Promise<string>((r) => {
        resolveLate = r;
      }),
      1000,
      { label: "x", onTimeout },
    );
    /* 先挂 no-op 拒绝处理器占住位（推进定时器到断言之间不许出现 unhandled rejection），
     * 断言本体在推进后 await —— 时序与旧的「先挂断言再推进」等价。 */
    p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    resolveLate("late");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

describe("withTimeoutResult", () => {
  it("按时完成给原结果", async () => {
    await expect(withTimeoutResult(Promise.resolve(7), 1000, null)).resolves.toBe(7);
  });

  it("超时给兜底值而不抛", async () => {
    vi.useFakeTimers();
    const p = withTimeoutResult<string | null>(never(), 500, null);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeNull();
  });

  it("超时给对象兜底（与 runFFmpeg 的 {code:-1} 同形）", async () => {
    vi.useFakeTimers();
    const p = withTimeoutResult(never(), 500, {
      code: -1,
      stderr: "timeout",
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toEqual({ code: -1, stderr: "timeout" });
  });

  it("成功路径清掉定时器", async () => {
    vi.useFakeTimers();
    await withTimeoutResult(Promise.resolve(1), 60_000, 0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("sleep", () => {
  it("等指定时长后 resolve", async () => {
    vi.useFakeTimers();
    const p = sleep(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeUndefined();
  });
});
