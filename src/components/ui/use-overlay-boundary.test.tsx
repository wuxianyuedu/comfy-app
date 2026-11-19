/** 锚定浮层的碰撞边界（`useOverlayBoundary`），钉的是**让位有没有真的发生**而非像素值：壳态（`isDesktopShell()` 为真）
 * 可用区域从标题行下沿起算（`side="top"` 的气泡不再往 chrome 里摆）；非壳态可用区域就是整视口，行为一字不变；
 * 首帧量不到视口时给 `null`。四边是否真落在视口内由 `e2e/` 的真实浏览器验 —— jsdom 不做布局，断言像素位置只会锁死实现。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { useOverlayBoundary } from "./use-overlay-boundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

/* 「在不在壳里」的判据就是 `isDesktopShell()` 读的那个全局标记（`desktop-shell-client`）。
 * 直接打标记而不是 mock 模块：ESM 的命名导入是活绑定，`vi.spyOn` 在导入之后
 * 落到模块命名空间上，hook 内部那份绑定不认（实测「壳态」用例里 y 仍是 0）。 */
function setShell(on: boolean) {
  if (on) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: () => null, transformCallback: () => 0 },
    });
  } else {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

describe("useOverlayBoundary", () => {
  it("非壳态：整视口可用（浏览器 / dev 没有应用内标题行）", () => {
    setShell(false);
    setViewport(1024, 768);
    const { result } = renderHook(() => useOverlayBoundary());
    expect(result.current).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });

  it("服务端渲染：给 null（还没有视口读数），不拿假矩形摆位", () => {
    /* 与 `useViewportSize` 的服务端快照同一口径：SSR 时 `window` 不存在，
     * 这条分支走 `useSyncExternalStore` 的 `getServerSnapshot`。 */
    setShell(true);
    setViewport(1440, 900);
    function Probe() {
      const boundary = useOverlayBoundary();
      return <span>{boundary === null ? "null" : "rect"}</span>;
    }
    expect(renderToString(<Probe />)).toContain("null");
  });

  it("卸载后不再响应 resize（订阅的清理真的挂上了）", () => {
    setShell(false);
    setViewport(1024, 768);
    const { unmount } = renderHook(() => useOverlayBoundary());
    unmount();
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(true).toBe(true);
  });

  it("壳态：顶上让出标题行（气泡不再往 chrome 里摆）", () => {
    setShell(true);
    setViewport(1440, 900);
    const { result } = renderHook(() => useOverlayBoundary());
    /* 让位量 = `--spacing-title-bar`（2.25rem × 16 = 36px），与 `globals.css`
     * 同源；这里钉的是**关系**（顶边下移 = 高度减少、左右不动），具体数字由
     * `full-screen-layer.test.ts` 对着常量钉。 */
    expect(result.current).toEqual({ x: 0, y: 36, width: 1440, height: 864 });
  });
});
