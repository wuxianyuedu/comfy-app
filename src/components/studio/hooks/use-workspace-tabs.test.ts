// @vitest-environment jsdom
// 页签恢复与落盘的**装配**判据（纯状态规则在 workspace-tabs.test.ts 判不到
// 「恢复那一步与落盘那一步在同一 commit 的先后」—— 那正是刷新后被踢出项目的现场，
// ISSUE #1501 / #1727）。无 JSX：`.test.ts` + createElement 包 StrictMode，不为此破例成 .tsx。
//
// 另加一条：侧栏项的页签行为是**可配置**的（ISSUE #3623），这里判「配置真的驱动了
// 页签的退场」—— 判据落在装配层（判据从哪来），纯规则层在 workspace-tabs.test.ts。
import { act, cleanup, render } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WS_TABS_KEY, parseWorkspaceTabs } from "../workspace-tabs";
import type { WorkspaceTabsController } from "./use-workspace-tabs";
import { WORKSPACE_VIEWS, useWorkspaceTabs } from "./use-workspace-tabs";

/* 配置面（侧栏项的页签行为）的替身：这一份 hook 只关心「判据从哪来」，不碰网络。 */
const configMock = vi.hoisted(() => ({
  config: undefined as Record<string, "independent" | "shared"> | undefined,
}));

vi.mock("./use-sidebar-tab-config", () => ({
  useSidebarTabConfigQuery: () => ({
    data: configMock.config === undefined ? undefined : { config: configMock.config },
    isPending: false,
  }),
}));

/* 刷新前的真实存储：首页 + 一个项目页。 */
const STORED = JSON.stringify({
  activeKey: "project:p1",
  tabs: [
    ["home", null],
    ["project", "p1"],
  ],
});

/** 最近一次渲染出来的 controller（探针把它挂在这儿，供用例调动作）。 */
let latest: WorkspaceTabsController | null = null;

/** 探针组件：只挂载被测 hook，不渲染任何东西。
 *  名字取 PascalCase 是为了过 `react-hooks/rules-of-hooks`（函数名不以大写开头
 *  时它不认这是个组件）。它在 `.ts` 文件里，不受文件命名规则约束。 */
function Probe() {
  latest = useWorkspaceTabs();
  return null;
}

/** 存储里的键还是不是那份项目页 —— 恢复没被初始态反冲的唯一判据。 */
function storedTabsSurvive(): boolean {
  const parsed = parseWorkspaceTabs(sessionStorage.getItem(WS_TABS_KEY), WORKSPACE_VIEWS);
  return parsed?.activeKey === "project:p1";
}

beforeEach(() => {
  sessionStorage.clear();
  configMock.config = undefined;
  latest = null;
});

afterEach(() => {
  cleanup();
});

describe("页签恢复不被落盘反冲", () => {
  it("挂载即恢复：存储里的项目页仍在，且没被初始态冲掉", async () => {
    sessionStorage.setItem(WS_TABS_KEY, STORED);
    render(createElement(Probe));
    /* 等的是**存进 sessionStorage 的那个值**（不是 DOM 出现 / 消失），
       所以按 §11.14.3 走 `expect.poll`，不用 `waitFor`。 */
    await expect.poll(storedTabsSurvive).toBe(true);
    expect(sessionStorage.getItem(WS_TABS_KEY)).toBe(STORED);
  });

  /* 这一条是**本缺陷的复现条件**：React 开发态（Next dev 默认开 StrictMode）
   * 会把 effect 跑两遍（挂载 → 卸载 → 再挂载）。旧写法里恢复只把「跑过了」记成
   * 布尔量，而落盘与它在同一个 commit、拿到的是初始态 ⇒ 存储被冲成「只有首页」。
   * 反向验证过：改回旧写法必红。 */
  it("StrictMode 双挂载下同样不被冲掉", async () => {
    sessionStorage.setItem(WS_TABS_KEY, STORED);
    render(createElement(StrictMode, null, createElement(Probe)));
    await expect.poll(storedTabsSurvive).toBe(true);
    expect(sessionStorage.getItem(WS_TABS_KEY)).toBe(STORED);
  });
});

describe("侧栏项的页签行为由配置面决定（ISSUE #3623）", () => {
  it("配置说「模型」是共享标签页时：切走它就退场", async () => {
    configMock.config = { models: "shared" };
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);
    act(() => {
      latest?.navigateTo("models");
    });
    act(() => {
      latest?.navigateTo("history");
    });
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "history"]);
  });

  it("配置说「模型」是独立标签页时：切走它仍留着", async () => {
    configMock.config = { models: "independent" };
    render(createElement(Probe));
    await expect.poll(() => latest !== null).toBe(true);
    act(() => {
      latest?.navigateTo("models");
    });
    act(() => {
      latest?.navigateTo("history");
    });
    expect(latest?.tabs.map((tab) => tab.view)).toEqual(["home", "models", "history"]);
  });
});
