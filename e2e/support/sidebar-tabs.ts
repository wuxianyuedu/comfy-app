import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 侧栏「临时页签」的 E2E 锚点（ISSUE #4770：顶部页签栏退役后的新家）。
 *
 * 旧断言找的是 `getByRole("tablist", { name: "已打开的视图" })`，那一栏已经不存在；
 * 页签现在混在侧栏导航里、按 `data-slot="sidebar-menu-button"` 与 `data-active` 表达
 * 切换/当前态，关闭按钮仍是「关闭 <标签>」。分组本身**没有页签时整组不渲染**
 * （AppShell 按 stripTabs + iframeTabs 判），所以「起步为空」要用 `toHaveCount(0)`，
 * 不能再用 `toBeVisible()` 等一个不存在的容器。
 *
 * 「+」开页的入口也随分组走：组内在场时点「打开视图」；起步为空时组不在场，
 * 走全局命令面板（Ctrl/⌘+K）开第一个非侧栏视图。
 */

export function tempTabsOf(page: Page): Locator {
  return page.getByTestId("sidebar-temp-tabs");
}

/** 分组里可切换的页签按钮（排除「打开视图」这个开新页的触发器）。 */
export function tempTabButtons(page: Page): Locator {
  return tempTabsOf(page)
    .locator('[data-slot="sidebar-menu-button"]')
    .filter({ hasNot: page.getByRole("button", { name: "打开视图", exact: true }) });
}

/** 分组在场时经「打开视图」菜单开一页。 */
export async function openFromTempMenu(page: Page, label: string): Promise<void> {
  const group = tempTabsOf(page);
  await expect(group, "临时页签组没渲染，无法从「打开视图」开页").toBeVisible();
  await group.getByRole("button", { name: "打开视图", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

/** 分组不在场（起步 0 页签）时经全局命令面板开一页。
 *
 *  热键监听在 React 水合完成后才挂上（AppShell 的 useHotkey）：本地快机上
 *  `load` 事件早于水合， presses 打在监听器挂上之前会被整颗丢掉 —— 面板永远
 *  不开（ISSUE #4946 的本地形态）。所以这里先等一个「壳已挂载」的锚点
 *  （侧栏容器），再按热键；面板没开就重按（`toPass` 整段重试），把「丢键」
 *  与「水合未完」两类竞态都吸收掉。 */
export async function openFromPalette(page: Page, label: string): Promise<void> {
  await expect(page.locator('[data-slot="sidebar-container"]')).toBeVisible();
  const input = page.getByPlaceholder("搜索视图或命令…");
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(input).toBeVisible();
  }).toPass({ timeout: 15_000 });
  await input.fill(label);
  await page
    .getByRole("option", { name: new RegExp(label) })
    .first()
    .click();
}

/** 任意时刻开一个临时页签：组在场走组里的菜单，否则走命令面板。 */
export async function openTempView(page: Page, label: string): Promise<void> {
  if ((await tempTabsOf(page).count()) > 0) {
    await openFromTempMenu(page, label);
    return;
  }
  await openFromPalette(page, label);
}

/** 当前页签按钮（按可见标签取第一个，标签可能因项目名带后缀）。 */
export function tempTabButton(page: Page, label: string): Locator {
  return tempTabButtons(page).filter({ hasText: label }).first();
}

/** 关闭一个临时页签。组件刻意绑 `onPointerDown`（ISSUE #3789：click 会落到行 <li> 上），
 *  Playwright 的 `.click()` 里那一下 pointerdown 又被同行的菜单按钮抢走，所以这里按
 *  组件真实监听的事件派发，而不是绕开可见性检查。 */
export async function closeTempTab(page: Page, label: string): Promise<void> {
  const button = tempTabsOf(page).getByRole("button", { name: `关闭 ${label}`, exact: true });
  await expect(button).toBeVisible();
  await button.dispatchEvent("pointerdown");
}
