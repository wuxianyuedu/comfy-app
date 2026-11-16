/**
 * `AppContextMenu` 的契约（ISSUE #4126）：应用级右键菜单兜底。
 *
 * 钉三件：① 没人管的右键 ⇒ preventDefault + 渲染应用主题菜单（不再露出
 * WebView2 默认的浅色系统菜单）；② 画布等已自处理（`defaultPrevented`）的
 * 右键 ⇒ 尊重原处理，不重复出菜单；③ 菜单在下一次 pointerdown / 失焦时收起，
 * 点「刷新页面」走 `location.reload` 并收起。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { AppContextMenu } from "~/components/AppContextMenu";

/** 在 body 上派发一个右键事件（bubble 到 window 的监听），回传事件本身。 */
function contextmenuAt(x: number, y: number): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  document.body.dispatchEvent(event);
  return event;
}

const menuEl = () => document.querySelector('[role="menu"]');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppContextMenu：右键菜单兜底（ISSUE #4126）", () => {
  it("没人管的右键 ⇒ preventDefault 并渲染应用主题菜单（刷新 / 后退 / 前进）", () => {
    render(<AppContextMenu />);
    let event: MouseEvent;
    act(() => {
      event = contextmenuAt(30, 40);
    });
    expect(event!.defaultPrevented).toBe(true);
    const menuNode = menuEl();
    if (!(menuNode instanceof HTMLElement)) {
      throw new Error("菜单没渲染成 HTMLElement");
    }
    expect(menuNode.style.left).toBe("30px");
    expect(menuNode.style.top).toBe("40px");
    expect(screen.getByRole("menuitem", { name: "刷新页面" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "后退" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "前进" })).toBeTruthy();
  });

  it("画布等已自处理的右键（先 preventDefault）⇒ 尊重原处理，不重复出菜单", () => {
    render(<AppContextMenu />);
    act(() => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      event.preventDefault();
      document.body.dispatchEvent(event);
    });
    expect(menuEl()).toBeNull();
  });

  it("下一次 pointerdown ⇒ 菜单收起", () => {
    render(<AppContextMenu />);
    act(() => {
      contextmenuAt(10, 10);
    });
    expect(menuEl()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(menuEl()).toBeNull();
  });

  it("点「刷新页面」⇒ location.reload 且菜单收起", () => {
    /* happy-dom 的 `location.reload` 不可 redefine ⇒ 用最小桩替身接住调用。 */
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    render(<AppContextMenu />);
    act(() => {
      contextmenuAt(10, 10);
    });
    act(() => {
      screen.getByRole("menuitem", { name: "刷新页面" }).click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(menuEl()).toBeNull();
  });
});
