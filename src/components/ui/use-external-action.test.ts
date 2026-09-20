// @vitest-environment jsdom
/**
 * `useExternalAction` —— 「触发一次外部动作」的执行态样板
 * （规范 16 §16.2.4.25）。
 *
 * 用例钉四处收口前**各判各的**地方：
 *  ① 结果字段差异（`ok` / `triggered`）不该漏到调用处；
 *  ② 空目标**在发起 IO 之前**拦下（不是把空串发给服务端吃 zod 的英文报错）；
 *  ③ 失败路径用 `errorMessage` 兜底成可读文案（硬规则 4）；
 *  ④ 连点两下**只发一次**（`busy` 是同步 ref，状态提交晚一拍挡不住）。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useExternalAction } from "./use-external-action";

describe("useExternalAction", () => {
  it("成功时按 ok 报（并归一 `triggered` 那种形状）", async () => {
    const report = vi.fn();
    const { result } = renderHook(() =>
      useExternalAction({ target: "browser", report }),
    );
    await act(async () => {
      await result.current.run(async () => ({ ok: true, detail: "已打开" }));
    });
    expect(report).toHaveBeenCalledWith("ok", "已打开");
    expect(result.current.busy).toBe(false);
  });

  it("只给 triggered 的动作也报成功（调用处不必记得读哪个字段）", async () => {
    const report = vi.fn();
    const { result } = renderHook(() =>
      useExternalAction({ target: "update", report }),
    );
    await act(async () => {
      await result.current.run(async () => ({ triggered: true }));
    });
    expect(report.mock.calls[0]?.[0]).toBe("ok");
  });

  it("动作抛错时用 errorMessage 兜底（失败路径必须有可读文案）", async () => {
    const report = vi.fn();
    const { result } = renderHook(() =>
      useExternalAction({ target: "folder", report }),
    );
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("ECONNREFUSED");
      });
    });
    const first = report.mock.calls[0] as [string, string];
    expect(first[0]).toBe("err");
    expect(first[1]).toContain("应用服务");
  });

  it("空消息的 Error 也不给空白文案（回落按目标给的动词）", async () => {
    /* `new Error("")` 的 message 是空串 —— `errorMessage` 对它回落到 fallback，
     * 而 fallback 由目标类别给出（调用处不再各写一句）。 */
    const report = vi.fn();
    const { result } = renderHook(() =>
      useExternalAction({ target: "folder", report }),
    );
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("");
      });
    });
    expect(report).toHaveBeenCalledWith("err", "打开目录失败");
  });

  it("runWithTarget：空目标**在发起 IO 之前**拦下（不调 action、不进 busy）", async () => {
    const report = vi.fn();
    const action = vi.fn();
    const { result } = renderHook(() =>
      useExternalAction({ target: "browser", report }),
    );
    await act(async () => {
      await result.current.runWithTarget("   ", action);
    });
    expect(action).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("err", "没有可打开的资源地址");
    expect(result.current.busy).toBe(false);
  });

  it("runWithTarget：有目标时把目标交给 action", async () => {
    const report = vi.fn();
    const action = vi.fn(async () => ({ ok: true, detail: "ok" }));
    const { result } = renderHook(() =>
      useExternalAction({ target: "browser", report }),
    );
    await act(async () => {
      await result.current.runWithTarget("https://x", action);
    });
    expect(action).toHaveBeenCalledWith("https://x");
    expect(report).toHaveBeenCalledWith("ok", "ok");
  });

  it("同一批事件里连点两下只发起一次（状态提交晚一拍挡不住）", async () => {
    const report = vi.fn();
    let resolve!: (v: { ok: boolean; detail: string }) => void;
    const action = vi.fn(
      () =>
        new Promise<{ ok: boolean; detail: string }>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() =>
      useExternalAction({ target: "browser", report }),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.run(action);
      /* 第二次**不 await**：此时 `setBusy(true)` 还没提交，只有同步 ref 挡得住。 */
      void result.current.run(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ok: true, detail: "done" });
      await first;
    });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("guard 返回 false 时整段跳过（不进 busy、不报错）", async () => {
    const report = vi.fn();
    const action = vi.fn();
    const { result } = renderHook(() =>
      useExternalAction({ target: "browser", report }),
    );
    await act(async () => {
      await result.current.run(action, async () => false);
    });
    expect(action).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("动作进行中 busy 为 true（界面据此显示「打开中…」）", async () => {
    let resolve!: (v: { ok: boolean; detail: string }) => void;
    const { result } = renderHook(() =>
      useExternalAction({ target: "browser", report: vi.fn() }),
    );
    let p!: Promise<void>;
    act(() => {
      p = result.current.run(
        () =>
          new Promise<{ ok: boolean; detail: string }>((r) => {
            resolve = r;
          }),
      );
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      resolve({ ok: true, detail: "done" });
      await p;
    });
    expect(result.current.busy).toBe(false);
  });
});
