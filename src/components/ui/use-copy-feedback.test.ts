// @vitest-environment jsdom
/**
 * 「复制到剪贴板之后给什么反馈」的唯一出口（规范 16 §16.2.4.43）。
 *
 * 收口前 14 个落点给出六种答案，其中一半**没有失败分支** —— 浏览器要
 * 「非安全上下文 / 无剪贴板权限」两条同时成立才会失败，所以在开发机上几乎
 * 复现不出来，只在打包后的 `http://` 里出现。用例因此把 `copyText` 的结果
 * 直接桩成成功 / 失败两态，逐条钉住：
 *  - 成功与失败**各自**都必须走各自的出口（这是这条账的核心）；
 *  - `onFailure: "silent"` 是**显式**静默，与「忘了写」在行为上一致、
 *    在代码上不同；
 *  - 重入期间重复点不发第二次写入（`setState` 是异步的，同一次事件循环里
 *    读不到刚写的值 —— 与 `useItemAction` 同一个坑）；
 *  - `useCopyResult` 只给成败、不触发反馈（调用处自己要把结果接进别的通道）。
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const copyText = vi.fn<(text: string) => Promise<boolean>>();

vi.mock("~/lib/browser-io", () => ({
  copyText: (text: string) => copyText(text),
}));

const { useCopyFeedback, useCopyResult } = await import("./use-copy-feedback");

beforeEach(() => {
  copyText.mockReset();
});

describe("useCopyFeedback", () => {
  it("成功走 onSuccess、失败走 onFailure", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    copyText.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useCopyFeedback({ onSuccess, onFailure }),
    );

    await act(async () => {
      result.current("文本");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(copyText).toHaveBeenCalledWith("文本");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(false);

    copyText.mockResolvedValue(true);
    await act(async () => {
      result.current("文本");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSuccess).toHaveBeenCalledWith(true);
  });

  it('`onFailure: "silent"` 是显式静默（与「忘了写」行为一致、写法不同）', async () => {
    copyText.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useCopyFeedback({ onFailure: "silent" }),
    );
    await act(async () => {
      result.current("文本");
      await Promise.resolve();
      await Promise.resolve();
    });
    /* 静默不等于没调出口：写入本身仍然发生了。 */
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it("重入期间重复点不发第二次写入（同步判重入，不等 setState）", async () => {
    let release: (v: boolean) => void = () => {
      /* 占位：由下面的 Promise 构造器同步赋成真正的 settle。 */
    };
    copyText.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useCopyFeedback());

    act(() => {
      result.current("第一次");
      /* 同一次事件循环里连点 —— `setState` 还没提交，只有同步 ref 拦得住。 */
      result.current("第二次");
    });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith("第一次");

    await act(async () => {
      release(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    /* 第一次落地后重入解除，可以再点。 */
    copyText.mockResolvedValue(true);
    act(() => result.current("第三次"));
    expect(copyText).toHaveBeenCalledTimes(2);
  });

  it("`copy(() => …)` 现算形态：文本在点击那一刻才取（日志面板的「复制全部」）", async () => {
    copyText.mockResolvedValue(true);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCopyFeedback({ onSuccess }));

    await act(async () => {
      result.current(() => Promise.resolve(true));
      await Promise.resolve();
      await Promise.resolve();
    });
    /* 现算形态自己负责写入，出口不该再调 `copyText`。 */
    expect(copyText).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(true);
  });

  it("`useCopyResult` 只给成败、不触发反馈（调用处自己接另一条通道）", async () => {
    copyText.mockResolvedValue(false);
    const { result } = renderHook(() => useCopyResult());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current("文本");
    });

    expect(ok).toBe(false);
    expect(copyText).toHaveBeenCalledWith("文本");
  });

  it("`useCopyResult` 重入期间直接给 false（正在飞的那次还没定论）", async () => {
    let release: (v: boolean) => void = () => {
      /* 占位：由下面的 Promise 构造器同步赋成真正的 settle。 */
    };
    copyText.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useCopyResult());

    let second: boolean | undefined;
    await act(async () => {
      void result.current("第一次");
      second = await result.current("第二次");
    });
    expect(second).toBe(false);
    expect(copyText).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(true);
      await Promise.resolve();
    });
  });
});
