// @vitest-environment jsdom
// 页签恢复与落盘的**装配**判据（纯状态规则在 workspace-tabs.test.ts 判不到
// 「恢复那一步与落盘那一步在同一 commit 的先后」—— 那正是刷新后被踢出项目的现场，
// ISSUE #1501 / #1727）。无 JSX：`.test.ts` + createElement 包 StrictMode，不为此破例成 .tsx。
import { createElement, StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WS_TABS_KEY, parseWorkspaceTabs } from "../workspace-tabs";
import { WORKSPACE_VIEWS, useWorkspaceTabs } from "./use-workspace-tabs";

/* 刷新前的真实存储：首页 + 一个项目页。 */
const STORED = JSON.stringify({
  activeKey: "project:p1",
  tabs: [
    ["home", null],
    ["project", "p1"],
  ],
});

/** 探针组件：只挂载被测 hook，不渲染任何东西。
 *  名字取 PascalCase 是为了过 `react-hooks/rules-of-hooks`（函数名不以大写开头
 *  时它不认这是个组件）。它在 `.ts` 文件里，不受文件命名规则约束。 */
function Probe() {
  useWorkspaceTabs();
  return null;
}

/** 存储里的键还是不是那份项目页 —— 恢复没被初始态反冲的唯一判据。 */
function storedTabsSurvive(): boolean {
  const parsed = parseWorkspaceTabs(sessionStorage.getItem(WS_TABS_KEY), WORKSPACE_VIEWS);
  return parsed?.activeKey === "project:p1";
}

describe("页签恢复不被落盘反冲", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

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
