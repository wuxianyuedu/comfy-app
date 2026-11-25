import { expect, test, type Locator, type Page } from "@playwright/test";

import { tempTabButtons } from "./support/sidebar-tabs";

/**
 * 「模型适配」「模式契约」作为**视图**的端到端判据（此前是侧栏点开的弹窗）。
 *
 * 侧栏常驻项（含这两项）自 #3740 后不再在顶部「已打开的视图」页签条里出 tab：
 * 打开/选中由侧栏按钮的激活态与打开态胶片表达，关闭在侧栏悬停态按钮上。
 * 本文件判的是「真的切到这一屏、内容真的渲染、没开弹窗」，以及切走后的挂载语义
 * （ISSUE #5003 起两屏出厂**独立标签页**：切走不关、保持挂载）。
 */

/* #4770 起页签在侧栏「临时页签」组：侧栏常驻项（含这两项）根本不进临时页签，
   所以断言改用「临时页签按钮为 0」，不再依赖已退役的顶部 tablist。 */
function stripOf(page: Page) {
  return tempTabButtons(page);
}

/** 侧栏里的某个全局项按钮（按可见名称命中第一颗）。 */
function sidebarItem(page: Page, label: string): Locator {
  return page.getByRole("button", { name: label, exact: true }).first();
}

async function openFromSidebar(page: Page, label: string): Promise<void> {
  const entry = sidebarItem(page, label);
  await expect(entry, `侧栏里找不到「${label}」入口`).toBeVisible();
  await entry.click();
}

/** 当前这一屏的 data-view 容器（视图栈里未隐藏的那一层）。 */
function activeView(page: Page, view: string): Locator {
  return page.locator(`[data-view="${view}"]:not(.hidden)`);
}

async function expectSidebarViewActive(page: Page, label: string, view: string): Promise<void> {
  /* Base UI 迁移后（ISSUE #4034）：激活态是 `data-active` 属性**在场**（值为空串），
     未激活时属性缺席 —— 断言在场即可，别按旧 Radix 的 "true" 值等。 */
  await expect(sidebarItem(page, label)).toHaveAttribute("data-active", {
    timeout: 20_000,
  });
  await expect(activeView(page, view)).toBeVisible({ timeout: 20_000 });
}

async function expectViewRendered(page: Page, entryLabel: string, view: string) {
  await openFromSidebar(page, entryLabel);
  await expectSidebarViewActive(page, entryLabel, view);
  /* 内容锚用该屏的 H1（PageHeader 恒渲染）：CI 的库是空的，模型适配/模式契约
   * 在空库下渲染的是「还没有远端模型」空态而不是编辑器 —— 按编辑器文本锚会
   * 永远红（ISSUE #4034）。 */
  await expect(page.getByRole("heading", { level: 1, name: entryLabel, exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("模型适配 / 模式契约作为视图 @critical", () => {
  test("开「模型适配」切到该视图并渲染内容，且不在对话框里", async ({ page }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模型适配", "model-adapters");
    await expect(stripOf(page).filter({ hasText: "模型适配" })).toHaveCount(0);
  });

  test("开「模式契约」切到该视图并渲染内容，且不在对话框里", async ({ page }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模式契约", "mode-contract");
    await expect(stripOf(page).filter({ hasText: "模式契约" })).toHaveCount(0);
  });

  test("两个独立视图先后打开：当前始终是最后打开的那一个，切走不关且不叠弹窗", async ({ page }) => {
    await page.goto("/workspace");
    await openFromSidebar(page, "模型适配");
    await expectSidebarViewActive(page, "模型适配", "model-adapters");
    await expect(
      page.getByRole("heading", { level: 1, name: "模型适配", exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    await openFromSidebar(page, "模式契约");
    await expectSidebarViewActive(page, "模式契约", "mode-contract");
    await expect(
      page.getByRole("heading", { level: 1, name: "模式契约", exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    await openFromSidebar(page, "首页");
    /* ISSUE #5003 起这两屏出厂是**独立标签页**：切走不关 —— 视图保持挂载、
       只是从当前屏让位成隐藏；曾经「瞬时视图切走即关」的判据随之反转。 */
    await expect(page.locator('[data-view="mode-contract"]')).toHaveCount(1);
    await expect(page.locator('[data-view="model-adapters"]')).toHaveCount(1);
    await expect(page.locator('[data-view="mode-contract"]')).toBeHidden();
    await expect(page.locator('[data-view="model-adapters"]')).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("工作流库页头那枚「模式契约」也切到同一视图，不再自己开第二层弹窗", async ({ page }) => {
    await page.goto("/workspace");

    await page.getByRole("button", { name: "工作流库", exact: true }).first().click();
    /* #3740：工作流库是侧栏常驻项，不进页签条 —— 选中态在侧栏 data-active 上。 */
    await expect(sidebarItem(page, "工作流库")).toHaveAttribute("data-active", {
      timeout: 20_000,
    });

    const headerBtn = page.getByRole("button", { name: /模式契约/ }).first();
    await expect(headerBtn).toBeVisible({ timeout: 20_000 });
    await headerBtn.click();

    await expectSidebarViewActive(page, "模式契约", "mode-contract");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
