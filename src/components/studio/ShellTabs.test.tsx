/**
 * `ShellTabs` 的壳层契约：标题行经插槽落进内容列（ISSUE #3807）、主窗口不打
 * `data-shell`；两种形态下都只渲染 `children`、不自己画页签栏。
 * iframe 页签的内容契约（#1244）在 `ShellTabContent.test.tsx`；「iframe 激活时
 * 侧栏仍可见、主应用内容让位」的装配判据在 `AppShell.sidebar-temp-tabs.test.tsx`
 * （ISSUE #4898：ShellTabs 不再在 iframe 激活时隐藏整棵 children）。
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ShellTabs } from "./ShellTabs";
import { useTitleBarSlot } from "./TitleBarSlot";

/** 摆形态：`true` = 桌面壳（打 Tauri 注入的全局标记），`false` = 浏览器 / dev。 */
function setShellForm(on: boolean) {
  if (on) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: () => null, transformCallback: () => 0 },
    });
  } else {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
}

/** 真实装配里消费插槽的是 `AppShell` 的 `SidebarInset`，这里用一层薄宿主扮它。 */
function TitleBarHost({ children }: { children: ReactNode }) {
  const slot = useTitleBarSlot();
  return (
    <>
      <div data-testid="title-bar-host">{slot}</div>
      {children}
    </>
  );
}

/** 挂一棵空壳。 */
function mountTabs() {
  return render(
    <ShellTabs>
      <TitleBarHost>
        <div data-testid="main-content">主应用内容</div>
      </TitleBarHost>
    </ShellTabs>,
  );
}

afterEach(() => {
  cleanup();
  setShellForm(false);
});

describe("ShellTabs · 壳层边界", () => {
  it("壳态标题行走插槽落进内容列，主窗口不再打 data-shell（ISSUE #3807）", () => {
    setShellForm(true);
    const view = mountTabs();
    try {
      /* 标题行不再占整窗第一行：`data-shell` 一旦回来，全局 CSS 就会重新把
       * fixed 侧栏下移 36px，「首页贴顶」又没了。整屏路由页仍用这个标记，但
       * 那棵子树不在这里（见 `ShellFullPage`）。 */
      expect(view.container.querySelector("[data-shell]")).toBeNull();
      /* 它确实被消费到了内容列那一侧，而不是被顺手丢掉 —— 窗口按钮与拖拽区
       * 还挂在这条标题行上（页签已在侧栏「临时页签」组，ISSUE #4770）。 */
      const host = screen.getByTestId("title-bar-host");
      const titleBar = host.querySelector('[data-slot="title-bar"]');
      expect(titleBar).not.toBeNull();
      /* 三颗窗口按钮仍挂在这条标题行上 —— 无边框窗口的最小化 / 最大化 / 关闭
       * 没有因为「搬到内容列」而丢掉（判据见 `WindowControls`）。 */
      expect(titleBar!.querySelectorAll("button[data-no-drag]")).toHaveLength(3);
    } finally {
      view.unmount();
    }
  });

  it("两种形态都只渲染 children、不画应用内页签栏，也不在这里藏主应用（ISSUE #4898）", () => {
    for (const shellForm of [true, false]) {
      setShellForm(shellForm);
      const view = mountTabs();
      try {
        /* 主应用内容恒可见：iframe 页签激活时的让位发生在 `AppShell` 内容列，
         * 不再是「整棵 children 被 `hidden`」（那会把侧栏切换器与窗口按钮一起
         * 藏掉，用户切不回主应用）。 */
        expect(screen.getByTestId("main-content")).not.toBeNull();
        expect(screen.getByTestId("main-content").closest(".hidden")).toBeNull();
        /* 浏览器自带页签栏，应用内再画一条既占纵向空间又与原生重复；
         * iframe 页签内容也归 `AppShell` 内容列（`ShellTabContent`），不在这层。 */
        expect(view.container.querySelectorAll(String.raw`[role="tablist"]`)).toHaveLength(0);
        expect(view.container.querySelectorAll("iframe")).toHaveLength(0);
      } finally {
        view.unmount();
      }
    }
  });
});
