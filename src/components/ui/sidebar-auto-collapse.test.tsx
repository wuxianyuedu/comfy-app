// @vitest-environment jsdom
/**
 * 左轨自动收起的接线判据（窄窗判据 → provider 生效态 → 提示文案的自动/手动之分）。
 *
 * 纯推导部分在 `src/lib/layout-budget.test.ts`；这里只钉「接起来对不对」：
 *   · 窄窗首屏就收起，且**不写 cookie**（纪律不能把用户偏好写脏 —— 写了下次启动
 *     就变成用户自己的选择了）；
 *   · 用户在窄窗里点开 → 生效态跟随用户，且提示要说「已按你的选择」而不是自动；
 *   · 窗口跨越阈值后回到纪律 —— 那条表态不该永久否决让位。
 *
 * 判据用 `innerWidth` 驱动 `matchMedia` 存根，与真浏览器同源（`use-narrow-nav`
 * 与 `use-mobile` 都读同一个数），不 mock 到「永远不窄」那种自洽状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { SidebarProvider, useSidebar } from "./sidebar";

/* jsdom 没有 matchMedia（本仓库既有测试的桩形态）；这里让它跟着 innerWidth 走，
   否则「窄窗」在用例里永远不可能成立。 */
const listeners = new Set<() => void>();

function setViewport(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
  act(() => {
    for (const cb of listeners) cb();
  });
}

beforeEach(() => {
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
      return max === undefined ? false : window.innerWidth <= Number(max);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: EventListenerOrEventListenerObject) => {
      listeners.add(cb as () => void);
    },
    removeEventListener: (
      _: string,
      cb: EventListenerOrEventListenerObject,
    ) => {
      listeners.delete(cb as () => void);
    },
  })) as unknown as typeof window.matchMedia;
  setViewport(1440);
});

afterEach(cleanup);

function Probe() {
  const { state, collapsedByAuto, toggleSidebar } = useSidebar();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="auto">{String(collapsedByAuto)}</span>
      <button type="button" onClick={toggleSidebar}>
        开关导航
      </button>
    </div>
  );
}

function mount(): void {
  render(
    <SidebarProvider>
      <Probe />
    </SidebarProvider>,
  );
}

function state(): string {
  return screen.getByTestId("state").textContent ?? "";
}

function isAuto(): string {
  return screen.getByTestId("auto").textContent ?? "";
}

describe("窄窗下左轨自动让位", () => {
  it("宽窗展开、窄窗收起，且收起被标成「自动」", () => {
    mount();
    expect(state()).toBe("expanded");
    expect(isAuto()).toBe("false");

    setViewport(1200);
    expect(state()).toBe("collapsed");
    expect(isAuto()).toBe("true");
  });

  it("窄窗里用户点开 → 听用户的；窗口再跨越阈值则回到纪律", () => {
    mount();
    setViewport(1200);
    expect(state()).toBe("collapsed");

    act(() => {
      screen.getByRole("button", { name: "开关导航" }).click();
    });
    expect(state()).toBe("expanded");
    /* 这一档窗宽下是用户的选择，不是纪律 —— 提示文案要能区分。 */
    expect(isAuto()).toBe("false");

    /* 放大窗口：宽窗 + 无表态（上次那条是「窄窗档」的）→ 仍展开（默认偏好）。 */
    setViewport(1500);
    expect(state()).toBe("expanded");
    /* 再缩回窄窗：那条豁免属于另一档窗宽，纪律重新接管。 */
    setViewport(1200);
    expect(state()).toBe("collapsed");
    expect(isAuto()).toBe("true");
  });

  it("自动收起不动 cookie：纪律不许把用户偏好写脏", () => {
    const writeSpy = vi.spyOn(document, "cookie", "set");
    mount();
    writeSpy.mockClear();
    setViewport(1100);
    expect(state()).toBe("collapsed");
    expect(writeSpy).not.toHaveBeenCalled();
    /* 用户自己点才算表态，才写偏好。 */
    act(() => {
      screen.getByRole("button", { name: "开关导航" }).click();
    });
    expect(writeSpy).toHaveBeenCalled();
  });
});
