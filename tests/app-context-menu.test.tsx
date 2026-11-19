/**
 * `AppContextMenu` 的契约（ISSUE #4132）：应用内右键菜单，样式与 WebView2
 * 默认菜单同款。钉三件：① 没人管的右键 ⇒ preventDefault + 渲染菜单；
 * ② 画布等已自处理（`defaultPrevented`）的右键 ⇒ 尊重原处理，不重复出菜单；
 * ③ 菜单在下一次 pointerdown / 失焦时收起，点「刷新页面」走 `location.reload`
 * 并收起。
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

describe("AppContextMenu：应用内右键菜单（ISSUE #4132）", () => {
  it("没人管的右键 ⇒ preventDefault 并渲染原生同款菜单（刷新 / 后退 / 前进）", () => {
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

describe("AppContextMenu 菜单项可点（#4417）", () => {
  it("菜单项上的 pointerdown 不卸载菜单：随后的 click 照常执行动作", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    render(<AppContextMenu />);
    act(() => {
      contextmenuAt(10, 10);
    });
    const item = screen.getByRole("menuitem", { name: "刷新页面" });
    act(() => {
      /* 真实浏览器事件序：菜单项上先 pointerdown、后 click。修缺陷前
       * pointerdown 把菜单卸了，click 派发时按钮已不在 DOM——动作永远不执行。 */
      item.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(menuEl()).not.toBeNull();
    act(() => {
      item.click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(menuEl()).toBeNull();
  });

  it("菜单之外的 pointerdown 仍收起菜单（关闭纪律不变）", () => {
    render(<AppContextMenu />);
    act(() => {
      contextmenuAt(10, 10);
    });
    expect(menuEl()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(menuEl()).toBeNull();
  });
});
