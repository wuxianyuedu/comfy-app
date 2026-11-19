import { expect, test, type Browser, type Locator } from "@playwright/test";

import { NAV_WIDTH_COLLAPSED_PX, NAV_WIDTH_EXPANDED_PX } from "../src/lib/layout-budget";

/**
 * 左轨让位在真浏览器里的形态（@critical）：单元层钉算式，这里钉**确实落到布局上** —— 收起真的让出宽度，只断言 `data-state` 会漏掉半截实现。
 * 两档跨阈值两侧（1280，算式在 `~/lib/layout-budget`）；状态用可重试断言（首帧由服务端快照决定、对账在提交之后），读早了会得到假的「没生效」。
 * 分两步报 `data-narrow` → `data-state`（ISSUE #1267），`data-narrow` 由 `sidebar.tsx` wrapper 出，是唯一可观测出口。
 */
async function openAtWidth(browser: Browser, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toBeVisible();
  return {
    ctx,
    page,
    sidebar,
    wrapper: page.locator('[data-slot="sidebar-wrapper"]'),
  };
}

/* 客户端判据到位：窄窗这一档必须先能看到 `data-narrow="true"`。 */
async function expectNarrow(wrapper: Locator, narrow: boolean) {
  await expect(wrapper).toHaveAttribute("data-narrow", narrow ? "true" : "false");
}

test.describe("左轨按窗宽自动让位 @critical", () => {
  test("宽窗展开、窄窗收起，且收起真的让出宽度", async ({ browser }) => {
    /* 宽度判据按布局账推导（`~/lib/layout-budget`：展开 160 / 收起 48），不再写死
       差值 —— 此前钉「差值 ≥150」，侧栏按 #3587 收窄到内容实需后差值只剩 112，
       判据过期误报（ISSUE #3657）。容差 ±2 只盖测量取整，改预算必须连这里的
       期望一起改，账与屏面不分叉。 */
    const wide = await openAtWidth(browser, 1500);
    await expectNarrow(wide.wrapper, false);
    await expect(wide.sidebar).toHaveAttribute("data-state", "expanded");
    await expect
      .poll(async () => (await wide.sidebar.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(NAV_WIDTH_EXPANDED_PX - 2);
    const wideWidth = (await wide.sidebar.boundingBox())?.width ?? 0;
    await wide.ctx.close();

    const narrow = await openAtWidth(browser, 1100);
    /* 先判客户端判据到位，再判生效态 —— 顺序即「两步」的语义，红了能定位到哪一步。 */
    await expectNarrow(narrow.wrapper, true);
    await expect(narrow.sidebar).toHaveAttribute("data-state", "collapsed");
    /* 让位是真的换了宽度，不只是改了属性：收起档必须落到图标轨宽。 */
    await expect
      .poll(async () => (await narrow.sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(NAV_WIDTH_COLLAPSED_PX + 2);
    const narrowWidth = (await narrow.sidebar.boundingBox())?.width ?? 0;
    await narrow.ctx.close();

    expect(wideWidth - narrowWidth, "收起没有真的让出宽度").toBeGreaterThanOrEqual(
      NAV_WIDTH_EXPANDED_PX - NAV_WIDTH_COLLAPSED_PX - 4,
    );
  });

  test("窄窗里用户点开导航就按他的选择展开，再点回收起", async ({ browser }) => {
    const { ctx, page, sidebar, wrapper } = await openAtWidth(browser, 1100);
    await expectNarrow(wrapper, true);
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");

    const trigger = page.getByRole("button", { name: "Toggle Sidebar" }).first();
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    /* 同一档窗宽内不回到自动 —— 用户刚表过态；再点一次仍按他的选择收起。 */
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await ctx.close();
  });
});
