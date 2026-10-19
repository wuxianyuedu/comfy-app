// @vitest-environment jsdom
// 页签恢复与落盘的**装配**判据（`workspace-tabs.test.ts` 判的是纯状态规则，
// 判不到「恢复那一步与落盘那一步在同一个 commit 里的先后」—— 而那一步正是
// 「刷新后用户被踢出项目」的现场，ISSUE #1501 / #1727）。
//
// 无 JSX：本档是 `.test.ts`（与同目录其它 hook 用例同形），StrictMode 那一条
// 用 `createElement` 包裹，免得为一个 wrapper 破例成 PascalCase 的 `.test.tsx`。
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
  const parsed = parseWorkspaceTabs(
    sessionStorage.getItem(WS_TABS_KEY),
    WORKSPACE_VIEWS,
  );
  return parsed?.activeKey === "project:p1";
}

describe("页签恢复不被落盘反冲", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

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
