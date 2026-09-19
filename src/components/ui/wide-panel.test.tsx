// @vitest-environment jsdom
/**
 * 「面板加宽档」出口的判据（规范 16 §16.2.4.18）。
 *
 * 这条账的形状与 `dialog-width` 相邻但不同：那个模块管「宽度怎么写才生效」，
 * 本模块管**加宽这个动作在三处各写一遍**，以及三处**共同欠着的一件事**——
 * 「加宽」这个选择没有任何记忆。所以用例重点分两半：
 *
 *  1. 收口本身：三份同形写法（`useState` + 两处三元 + 按钮文案与图标）
 *     现在由一处给出，且 `widthClass` / `toggleLabel` 两处不可能不一致；
 *  2. 补上的行为：**加宽态跨挂载保持**（关掉面板再打开仍是用户选过的档），
 *     以及「没有记录时用调用处给的默认档」。
 *
 * ⚠️ 每个用例都要 `resetWidePanelsForTest()` —— `WIDE_PANELS` 是模块级单例，
 * 跨用例会串（这与 `useCanvasSettings` 的 store 是同一形态）。
 */
import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModalWidth } from "./dialog-width";
import {
  resetWidePanelsForTest,
  useWidePanel,
  WidePanelToggle,
} from "./wide-panel";

const WIDTHS: ModalWidth = { base: "w-5xl", wide: "w-[calc(100vw-16px)]" };

beforeEach(() => {
  resetWidePanelsForTest();
  window.localStorage.clear();
});

describe("useWidePanel", () => {
  it("缺省是窄档，宽度类取 base", () => {
    const { result } = renderHook(() => useWidePanel("p1", WIDTHS));
    expect(result.current.wide).toBe(false);
    expect(result.current.widthClass).toBe(WIDTHS.base);
    expect(result.current.toggleLabel).toBe("加宽");
  });

  it("toggle 切到加宽档，宽度类与文案同步变化", () => {
    const { result } = renderHook(() => useWidePanel("p2", WIDTHS));
    act(() => result.current.toggle());
    expect(result.current.wide).toBe(true);
    expect(result.current.widthClass).toBe(WIDTHS.wide);
    expect(result.current.toggleLabel).toBe("收缩");
  });

  it("set 是显式设置，不翻转", () => {
    const { result } = renderHook(() => useWidePanel("p3", WIDTHS));
    act(() => result.current.set(true));
    act(() => result.current.set(true));
    expect(result.current.wide).toBe(true);
  });

  it("调用处可以给「默认就该加宽」的档位", () => {
    const { result } = renderHook(() => useWidePanel("p4", WIDTHS, true));
    expect(result.current.wide).toBe(true);
    expect(result.current.widthClass).toBe(WIDTHS.wide);
  });

  it("localStorage 不可用时静默降级（记忆是增强，不是功能）", () => {
    /* 隐私模式 / 配额满 / storage 被禁用：本会话仍然可用，只是丢了记忆。 */
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    const { result } = renderHook(() => useWidePanel("p0", WIDTHS));
    expect(result.current.wide).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.wide).toBe(true);
    getItem.mockRestore();
  });

  it("storage 里存着非法值时回落到调用处给的默认档", () => {
    window.localStorage.setItem("comfyapp:wide-panel:p0b", "garbage");
    const { result } = renderHook(() => useWidePanel("p0b", WIDTHS, true));
    expect(result.current.wide).toBe(true);
  });

  describe("记忆（这是三份实现此前共同欠着的那件事）", () => {
    it("加宽态跨挂载保持：关掉面板再打开仍是用户选过的档", () => {
      const first = renderHook(() => useWidePanel("p5", WIDTHS));
      act(() => first.result.current.toggle());
      first.unmount();

      const second = renderHook(() => useWidePanel("p5", WIDTHS));
      expect(second.result.current.wide).toBe(true);
    });

    it("不同面板各记各的（id 就是记忆的键）", () => {
      const a = renderHook(() => useWidePanel("p6a", WIDTHS));
      const b = renderHook(() => useWidePanel("p6b", WIDTHS));
      act(() => a.result.current.toggle());
      expect(a.result.current.wide).toBe(true);
      expect(b.result.current.wide).toBe(false);
    });

    it("同一次会话内两份实例同步（按钮在标题栏、面板体在 Portal 里）", () => {
      const a = renderHook(() => useWidePanel("p7", WIDTHS));
      const b = renderHook(() => useWidePanel("p7", WIDTHS));
      act(() => a.result.current.toggle());
      expect(b.result.current.wide).toBe(true);
    });

    it("localStorage 里存的是可读的载体（不是直接把对象塞进去）", () => {
      const a = renderHook(() => useWidePanel("p8", WIDTHS));
      act(() => a.result.current.set(true));
      expect(window.localStorage.getItem("comfyapp:wide-panel:p8")).toBe("1");
      act(() => a.result.current.set(false));
      expect(window.localStorage.getItem("comfyapp:wide-panel:p8")).toBe("0");
    });
  });
});

describe("WidePanelToggle", () => {
  it("按钮的 title 与 aria-label 同源（改名不会漏一处）", () => {
    const { result } = renderHook(() => useWidePanel("b1", WIDTHS));
    const { getByRole } = render(<WidePanelToggle panel={result.current} />);
    const btn = getByRole("button", { name: "加宽" });
    expect(btn.getAttribute("title")).toBe("加宽");
  });

  it("点击切换档位（并把档位落到 localStorage）", () => {
    const { result } = renderHook(() => useWidePanel("b2", WIDTHS));
    /* 用 `data-testid` 收窄查询：同一文件里前一个用例渲染的同名按钮
     * （`getByRole("button")`）会留在 DOM 里。 */
    const { getByTestId } = render(
      <span data-testid="host">
        <WidePanelToggle panel={result.current} />
      </span>,
    );
    act(() => getByTestId("host").querySelector("button")?.click());
    expect(window.localStorage.getItem("comfyapp:wide-panel:b2")).toBe("1");
  });
});
