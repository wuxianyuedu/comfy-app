/**
 * 壳内 ComfyUI 页签的**两条契约**（ISSUE #1244）。
 *
 * 用户要的形态是「同一个窗口里的多页签」（ISSUE #310 原话：「只要多页签，不要
 * 另一个窗口」），落在 ComfyUI 这一格上是两句可判的话：
 *
 *   1. **可嵌时**：内容渲染在**当前窗口的页签里**（一个 `iframe`，`title` 就是页签名）；
 *   2. **不可嵌时**：仍在**同一个页签里**给出可读说明（说明带内容地址），
 *      既不塞一个注定空白的 `iframe`，也不弹第二个窗口。
 *
 * 这两条此前没有任何自动化看守：#1243 把 e2e 那三条改成浏览器形态契约之后，
 * 壳内这半边就成了盲区 —— 浏览器形态下 `ShellTabs` **不渲染任何应用内页签栏**
 * （`useTitleBarTabsActive` 假），iframe 与说明都只存在于桌面壳里。本文件在
 * jsdom 里把形态摆到壳内那一档，判的是**用户能看见的结构**（规范 11.2），
 * 不是实现细节。
 *
 * 壳形态怎么摆：`useTitleBarTabsActive` 读的就是 `isDesktopShell()` 读的那个全局
 * 标记（`__TAURI_INTERNALS__`），所以直接打标记、不 mock 模块 —— 组件树里
 * `ShellTabs` 与 `TitleBarTabs` 各读它一次，而 ESM 的命名导入是活绑定，按模块
 * mock 要连 store 与 hook 一起假掉才能让整棵树挂起来。同一个手法见
 * `use-overlay-boundary.test.tsx`。
 *
 * ⚠️ 刻意**不判**的：页签的点击 / 关闭交互（那是 store 与 `TitleBarTabs` 各自的
 * 账）、层叠关系与真实 iframe 导航（jsdom 不做布局也不发请求，那两条留给 e2e 与
 * 壳冒烟，见规范 §11.10.4）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";

import { ShellTabs } from "./ShellTabs";

/** 摆形态：`true` = 桌面壳（打 Tauri 注入的全局标记），`false` = 浏览器 / dev。 */
function setShellForm(on: boolean) {
  if (on) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: async () => null, transformCallback: () => 0 },
    });
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

function resetTabs() {
  useShellTabs.setState({
    tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
    activeTabId: MAIN_TAB_ID,
  });
}

/** 按设置页那条真实路径开一个 ComfyUI 页签（字段照抄 `use-settings-page-comfy`）。 */
function openComfyTab(patch: {
  url?: string | null;
  blockedReason?: string | null;
  blockedUrl?: string | null;
}) {
  useShellTabs.getState().openTab({
    id: "comfyui",
    label: "ComfyUI",
    url: patch.url ?? null,
    closable: true,
    blockedReason: patch.blockedReason ?? null,
    blockedUrl: patch.blockedUrl ?? null,
  });
}

/* 剪贴板桩：说明里那颗「复制地址」会经 `~/lib/browser-io` 的 `copyText` 写剪贴板，
 * 而它在 jsdom 里的兜底路径会往 `document.body` 挂一个临时 `textarea`（handle 残留）。
 * 用例不必真碰剪贴板，给一份成功实现即可 —— 本文件因此也**不用**那条兜底路径。 */
const written: string[] = [];

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void written.push(text) },
  });
});

/** 挂一棵空壳（每个用例自己 `unmount`：泄漏的树会让后面的计数一起偏）。 */
function mountTabs() {
  return render(
    <ShellTabs>
      <div data-testid="main-content">主应用内容</div>
    </ShellTabs>,
  );
}

beforeEach(resetTabs);

afterEach(() => {
  cleanup();
  resetTabs();
  setShellForm(false);
});

describe("ShellTabs · 壳内 ComfyUI 页签", () => {
  it("可嵌：内容渲染在页签内（iframe 的 title 是页签名），仍是同一个窗口", () => {
    setShellForm(true);
    openComfyTab({ url: "http://127.0.0.1:8188" });
    const view = mountTabs();
    try {
      /* iframe 就在这一棵子树里，`title` 是页签名（读屏器与 e2e 都靠它认）。 */
      const frame = screen.getByTitle("ComfyUI");
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("src")).toBe("http://127.0.0.1:8188");
      expect(view.container.contains(frame)).toBe(true);

      /* 「同一个窗口」不是靠说的 —— 壳内页签栏（`TitleBarTabs`）与 iframe 在同一棵
       * 子树里：两个页签（主应用 + ComfyUI），且只有这一个 iframe。 */
      expect(screen.getAllByRole("tab")).toHaveLength(2);
      expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  it("不可嵌：页签内给可读说明（带地址），同时**不塞**注定空白的 iframe", () => {
    setShellForm(true);
    const url = "http://127.0.0.1:8188";
    openComfyTab({
      url,
      blockedReason: "目标拒绝了跨源内嵌（X-Frame-Options: DENY）",
      blockedUrl: url,
    });
    const view = mountTabs();
    try {
      /* 说明在页签里：一句「无法在此页签中显示 ComfyUI」，加成因与地址。 */
      expect(screen.getByText("无法在此页签中显示 ComfyUI")).not.toBeNull();
      expect(screen.getByText(/X-Frame-Options: DENY/)).not.toBeNull();
      expect(screen.getByText(url)).not.toBeNull();

      /* 另一半是「不许塞空白 iframe」——少了它，界面只剩一片空白错误页，
       * 用户既看不出被谁拦、也没有下一步（ISSUE #310 第三次回归现场）。 */
      expect(view.container.querySelectorAll("iframe")).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it("页签既无地址也无拦截说明时给空态（不塞空白 iframe）", () => {
    setShellForm(true);
    /* 形态由 store 状态直接决定，这一档在真实链路上进不来（设置页要么给 `url`、
     * 要么给 `blockedReason`），所以这里直接摆状态而不是假装走一遍。
     * 判它的理由是「三分支里最后那一个」：若只有它没人判，一次误改就会让页签里
     * 只剩一片空白 —— 与 ISSUE #310 记的那类现场同一个姿态。 */
    openComfyTab({});
    const view = mountTabs();
    try {
      expect(screen.getByText("页签内容为空")).not.toBeNull();
      expect(view.container.querySelectorAll("iframe")).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it("切页签只切显隐：非当前页签带 aria-hidden 且保持挂载", () => {
    setShellForm(true);
    openComfyTab({ url: "http://127.0.0.1:8188" });
    const view = mountTabs();
    try {
      /* 主应用页签用 `hidden` 隐藏（不是卸载），所以画布状态不会因切页签丢掉；
       * 非当前页签那层带 `aria-hidden="true"`，读屏器不会念到看不见的内容。 */
      expect(
        screen.getByTestId("main-content").closest(".hidden"),
      ).not.toBeNull();
      /* 非当前页签那层的 `aria-hidden` 由「这一格是不是当前页签」直接给出。 */
      const host = () =>
        view.container.querySelector("iframe")!.closest("div")!;
      expect(host().getAttribute("aria-hidden")).toBe("false");

      /* 切回主应用：ComfyUI 页签那一格变成 hidden + aria-hidden，iframe 仍在树上
       *（「始终挂载」是这一格的判据，也是「切回来不会重新加载 ComfyUI」的原因）。 */
      act(() => {
        useShellTabs.getState().activateTab(MAIN_TAB_ID);
      });
      expect(host().className).toContain("hidden");
      expect(host().getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByTestId("main-content").closest(".hidden")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it("说明里的地址可复制，且复制成功有可见反馈（不静默）", async () => {
    setShellForm(true);
    const url = "http://127.0.0.1:8188";
    openComfyTab({
      url,
      blockedReason: "目标拒绝了跨源内嵌（X-Frame-Options: DENY）",
      blockedUrl: url,
    });
    const view = mountTabs();
    try {
      /* 地址就在说明里印着 —— 用户能手动选中，这是「失败也不打扰」的前提
       *（`onFailure: \"silent\"`），所以这里只钉成功那半：点下去真的写进剪贴板、
       * 按钮文案换成「已复制」。少了这一句，那颗按钮点下去界面毫无变化，
       * 用户不知道成没成（规范 16 §16.2.4.43 的现场）。 */
      fireEvent.click(screen.getByRole("button", { name: "复制地址" }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(written).toEqual([url]);
      expect(screen.getByRole("button", { name: "已复制" })).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  it("浏览器 / dev：应用内不画页签栏（ComfyUI 交给新浏览器页签）", () => {
    setShellForm(false);
    openComfyTab({ url: "http://127.0.0.1:8188" });
    const view = mountTabs();
    try {
      /* 判据是 `shouldUseBrowserTab`：浏览器自带页签栏，应用内再画一条假页签栏
       * 既占纵向空间又与原生重复。所以两件事都不发生 ——
       *   · 没有壳内那条「应用页签」栏（`TitleBarTabs` 的 `role="tablist"`）；
       *   · 主应用内容照常承载。
       * ⚠️ 与 e2e 那条并不重复：那里量的是**页面上**（`iframe[title=ComfyUI]`
       * 计数 0），因为浏览器形态下「打开查看」走的是新浏览器页签、store 里本来
       * 不会长出 ComfyUI 页签；而这里为了把形态摆到浏览器那一档，直接往 store 里
       * 塞了一个页签 —— 内容区按设计「始终挂载、只切显隐」，所以这棵树里**会有**
       * 一个 iframe。这是两条用例的构造差异，不是判据冲突。 */
      expect(screen.getByTestId("main-content")).not.toBeNull();
      expect(
        view.container.querySelectorAll(String.raw`[role="tablist"]`),
      ).toHaveLength(0);
      /* 顺带钉住「不按形态改内容」这条实现取舍：这一格在两种形态下渲染得**一模一样**，
       * 所以浏览器形态里那个 iframe 照样挂在树上（只是这一格不该被走到）。
       * 如果哪天有人给它加一个 `if (useTitleBar)` 之类的分叉，这条会红 ——
       * 那是有意的：分叉一出现，「浏览器里长不长 iframe」就变成两种形态各说各话。 */
      expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });
});
