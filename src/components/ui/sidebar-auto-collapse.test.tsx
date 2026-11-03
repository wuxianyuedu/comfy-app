/** 左轨自动收起的接线判据（窄窗判据 → provider 生效态 → 提示文案的自动/手动之分）；
 * 纯推导在 `src/lib/layout-budget.test.ts`。窄窗首屏即收起且**不写 cookie**（纪律不能
 * 把用户偏好写脏），用户窄窗里点开则跟随用户并提示「已按你的选择」，窗口跨越阈值后回到
 * 纪律。判据用 `innerWidth` 驱动 `matchMedia` 存根，与真浏览器同源（两边读同一个数）。 */
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
    for (const cb of listeners) {
      cb();
    }
  });
}

beforeEach(() => {
  listeners.clear();
  /* SAFETY: 类型断言已复核 */
  window.matchMedia = ((query: string) => ({
    get matches() {
      const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
      return max === undefined ? false : window.innerWidth <= Number(max);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: EventListenerOrEventListenerObject) => {
      /* SAFETY: 类型断言已复核 */
      listeners.add(cb as () => void);
    },
    removeEventListener: (_: string, cb: EventListenerOrEventListenerObject) => {
      /* SAFETY: 类型断言已复核 */
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
      <button onClick={toggleSidebar} type="button">
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

  /* ISSUE #1267 回归：首帧对账不能被订阅周期绑住。React 开发态双挂载（挂载 → 卸载 →
   * 再挂载）时，旧实现把 `setTimeout(0)` 的通知挂在订阅清理函数上，卸载的 `clearTimeout`
   * 取消了它 —— 「进页面时已是窄窗」无人通知，`data-state` 停在服务端「展开」，并发 E2E
   * 里要等无关重渲染（晚到 5s+）才纠正（`--workers=1` 串行则绿）。这里显式跑「卸载 →
   * 再挂载」，且只让模块级那次通知对账：期间不派发任何 `change`。 */
  it("订阅被卸载再挂载后，首帧对账仍由 store 自己的通知落地", async () => {
    mount();
    expect(state()).toBe("expanded");

    /* 窄窗（订阅建立之前就是），不派发 change。 */
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1100,
      writable: true,
    });

    /* 双挂载的第二跳：整棵树卸载再挂载，中间那次清理会取消「第一跳」排的通知。 */
    cleanup();
    mount();

    /* 宏任务跑到后，对账要自己落地 —— 不靠任何外部重渲染。 */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
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
