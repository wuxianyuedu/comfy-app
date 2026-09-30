import { expect, test, type Browser } from "@playwright/test";

/**
 * 左轨让位在真浏览器里的形态（@critical）。
 *
 * 单元层（`src/lib/layout-budget.test.ts` + `sidebar-auto-collapse.test.tsx`）钉的是
 * 算式与推导；这里钉的是**确实落到了布局上**：窄一档收起、宽一档展开，而且收起真的
 * 让出了宽度 —— 只断言 `data-state` 的话，「属性改了但宽度没跟着改」这种半截实现会漏过去。
 *
 * 两档取值刻意跨在阈值两侧（阈值 1280，算式在 `~/lib/layout-budget`）。
 *
 * ⚠️ 状态一律用**可重试断言**取：首帧由服务端快照决定（按非窄窗渲染），客户端对账排在
 * 提交之后 —— 一次性 `getAttribute` 会读在那之前，得到假的「没生效」（实测踩过）。
 */
async function openAtWidth(browser: Browser, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toBeVisible();
  return { ctx, page, sidebar };
}

test.describe("左轨按窗宽自动让位 @critical", () => {
  test("宽窗展开、窄窗收起，且收起真的让出宽度", async ({ browser }) => {
    const wide = await openAtWidth(browser, 1500);
    await expect(wide.sidebar).toHaveAttribute("data-state", "expanded");
    const wideWidth = (await wide.sidebar.boundingBox())?.width ?? 0;
    await wide.ctx.close();

    const narrow = await openAtWidth(browser, 1100);
    await expect(narrow.sidebar).toHaveAttribute("data-state", "collapsed");
    /* 让位是真的换了宽度，不只是改了属性（收起档 3rem=48px，给余量取 <100）。 */
    await expect
      .poll(async () => (await narrow.sidebar.boundingBox())?.width ?? 0)
      .toBeLessThan(100);
    const narrowWidth = (await narrow.sidebar.boundingBox())?.width ?? 0;
    await narrow.ctx.close();

    expect(
      wideWidth - narrowWidth,
      "收起没有真的让出宽度",
    ).toBeGreaterThanOrEqual(150);
  });

  test("窄窗里用户点开导航就按他的选择展开，再点回收起", async ({
    browser,
  }) => {
    const { ctx, page, sidebar } = await openAtWidth(browser, 1100);
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");

    const trigger = page
      .getByRole("button", { name: "Toggle Sidebar" })
      .first();
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    /* 同一档窗宽内不回到自动 —— 用户刚表过态；再点一次仍按他的选择收起。 */
    await trigger.click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await ctx.close();
  });
});
