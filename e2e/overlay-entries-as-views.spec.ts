import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 「模型适配」「模式契约」作为**视图**的端到端判据（此前是侧栏点开的弹窗）。
 *
 * 侧栏常驻项（含这两项）自 #3740 后不再在顶部「已打开的视图」页签条里出 tab：
 * 打开/选中由侧栏按钮的激活态与打开态胶片表达，关闭在侧栏悬停态按钮上。
 * 本文件判的是「真的切到这一屏、内容真的渲染、没开弹窗」以及瞬时视图切走即关。
 */

function stripOf(page: Page) {
  return page.getByRole("tablist", { name: "已打开的视图" });
}

/** 侧栏里的某个全局项按钮（按可见名称命中第一颗）。 */
function sidebarItem(page: Page, label: string): Locator {
  return page.getByRole("button", { name: label, exact: true }).first();
}

async function openFromSidebar(page: Page, label: string): Promise<void> {
  const strip = stripOf(page);
  await expect(strip).toBeVisible({ timeout: 30_000 });
  const entry = sidebarItem(page, label);
  await expect(entry, `侧栏里找不到「${label}」入口`).toBeVisible();
  await entry.click();
}

/** 当前这一屏的 data-view 容器（视图栈里未隐藏的那一层）。 */
function activeView(page: Page, view: string): Locator {
  return page.locator(`[data-view="${view}"]:not(.hidden)`);
}

async function expectSidebarViewActive(page: Page, label: string, view: string): Promise<void> {
  await expect(sidebarItem(page, label)).toHaveAttribute("data-active", "true", {
    timeout: 20_000,
  });
  await expect(activeView(page, view)).toBeVisible({ timeout: 20_000 });
}

async function expectViewRendered(
  page: Page,
  entryLabel: string,
  view: string,
  contentAnchors: Array<string>,
) {
  await openFromSidebar(page, entryLabel);
  await expectSidebarViewActive(page, entryLabel, view);
  for (const text of contentAnchors) {
    // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行断言，并行会让失败归因与截图错位
    await expect(activeView(page, view).getByText(text).first()).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("模型适配 / 模式契约作为视图 @critical", () => {
  test("开「模型适配」切到该视图并渲染内容，且不在对话框里", async ({ page }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模型适配", "model-adapters", ["模型适配器", "新建适配器"]);
    await expect(stripOf(page).getByRole("tab", { name: /模型适配/ })).toHaveCount(0);
  });

  test("开「模式契约」切到该视图并渲染内容，且不在对话框里", async ({ page }) => {
    await page.goto("/workspace");
    await expectViewRendered(page, "模式契约", "mode-contract", [
      "模式契约",
      "选择模型类型",
      "模式契约注册表",
    ]);
    await expect(stripOf(page).getByRole("tab", { name: /模式契约/ })).toHaveCount(0);
  });

  test("两个瞬时视图先后打开：当前始终是最后打开的那一个，切走即关且不叠弹窗", async ({ page }) => {
    await page.goto("/workspace");
    await openFromSidebar(page, "模型适配");
    await expectSidebarViewActive(page, "模型适配", "model-adapters");
    await expect(
      activeView(page, "model-adapters").getByText("模型适配器", { exact: true }),
    ).toBeVisible({
      timeout: 20_000,
    });

    await openFromSidebar(page, "模式契约");
    await expectSidebarViewActive(page, "模式契约", "mode-contract");
    await expect(
      activeView(page, "mode-contract").getByText("选择模型类型", { exact: true }),
    ).toBeVisible({
      timeout: 20_000,
    });

    await openFromSidebar(page, "首页");
    await expect(page.locator('[data-view="mode-contract"]')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[data-view="model-adapters"]')).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("工作流库页头那枚「模式契约」也切到同一视图，不再自己开第二层弹窗", async ({ page }) => {
    await page.goto("/workspace");
    const strip = stripOf(page);
    await expect(strip).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "工作流库", exact: true }).first().click();
    await expect(strip.getByRole("tab").filter({ hasText: "工作流库" })).toHaveCount(1);

    const headerBtn = page.getByRole("button", { name: /模式契约/ }).first();
    await expect(headerBtn).toBeVisible({ timeout: 20_000 });
    await headerBtn.click();

    await expectSidebarViewActive(page, "模式契约", "mode-contract");
    await expect(
      activeView(page, "mode-contract").getByText("选择模型类型", { exact: true }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
