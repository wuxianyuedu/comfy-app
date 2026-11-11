// @vitest-environment jsdom
// 启动补前台 hook 的重挂契约（ISSUE #3568，跟进 #3562）。
// 锁住三件事：① 只在壳答复「该给前台」时补唤；② 组件重挂 / StrictMode 双跑
// effect 不会再抢一次（一次性消费在 Rust 侧 `take_startup_activation`，这里按
// 壳的答复序列模拟）；③ 异步答复落地前组件已卸载就不再补前台。
// 本目录在 node 档，renderHook 要 DOM ⇒ 按 §11.17 用文件头声明 jsdom。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";

import { activateMainWindow, shouldActivateWindowOnLaunch } from "~/lib/shell/desktop-shell-client";

import { useStartupForeground } from "./use-startup-foreground";

vi.mock("~/lib/shell/desktop-shell-client", () => ({
  shouldActivateWindowOnLaunch: vi.fn(),
  activateMainWindow: vi.fn(),
}));

const shouldActivate = vi.mocked(shouldActivateWindowOnLaunch);
const activate = vi.mocked(activateMainWindow);

/** 把 then / await 链上的微任务全部放完（不引入定时器，用例跑得确定）。 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  shouldActivate.mockReset();
  activate.mockReset();
  // 默认是不给前台；需要「首次放行」的用例用 mockResolvedValueOnce 排队。
  shouldActivate.mockResolvedValue(false);
  activate.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useStartupForeground：启动补前台只发生一次", () => {
  it("壳答复 true ⇒ 补唤主窗一次", async () => {
    shouldActivate.mockResolvedValueOnce(true);

    renderHook(() => {
      useStartupForeground();
    });

    await expect.poll(() => activate).toHaveBeenCalledTimes(1);
    expect(shouldActivate).toHaveBeenCalledTimes(1);
  });

  it("壳答复 false ⇒ 不发任何窗口动作", async () => {
    renderHook(() => {
      useStartupForeground();
    });

    await settle();
    expect(shouldActivate).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });

  it("卸载后重挂不再补前台（启动标记被壳一次性消费）", async () => {
    shouldActivate.mockResolvedValueOnce(true);
    const first = renderHook(() => {
      useStartupForeground();
    });
    await expect.poll(() => activate).toHaveBeenCalledTimes(1);

    first.unmount();
    renderHook(() => {
      useStartupForeground();
    });
    await settle();

    expect(shouldActivate).toHaveBeenCalledTimes(2);
    // 第二次壳答复 false：路由切页 / 页签重挂都不该把用户从别的窗口拉回来。
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 双跑 effect 也只补唤一次（同一实例只问壳一次）", async () => {
    shouldActivate.mockResolvedValueOnce(true);

    renderHook(
      () => {
        useStartupForeground();
      },
      { wrapper: StrictMode },
    );
    await settle();

    // 首轮 effect 若单独问一次，就会消费掉壳的一次性标记、又因 cleanup 被取消，
    // 活着的第二轮拿到 false ⇒ 开发模式反而丢掉这次补前台。
    expect(shouldActivate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("壳答复 reject ⇒ 静默降级，不抛未捕获异常也不补前台", async () => {
    shouldActivate.mockRejectedValue(new Error("invoke failed"));

    renderHook(() => {
      useStartupForeground();
    });
    await settle();

    expect(shouldActivate).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });

  it("答复落地前组件已卸载 ⇒ 不再补前台", async () => {
    let resolveShouldActivate!: (value: boolean) => void;
    shouldActivate.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveShouldActivate = resolve;
        }),
    );

    const { unmount } = renderHook(() => {
      useStartupForeground();
    });
    unmount();
    await act(async () => {
      resolveShouldActivate(true);
      await Promise.resolve();
    });

    expect(activate).not.toHaveBeenCalled();
  });
});
