import { expect, test, type Browser, type Locator } from "@playwright/test";

import {
  NAV_AUTO_COLLAPSE_MAX_PX,
  NAV_WIDTH_COLLAPSED_PX,
  NAV_WIDTH_EXPANDED_PX,
} from "../src/lib/layout-budget";

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
  const wrapper = page.locator('[data-slot="sidebar-wrapper"]');
  /* ISSUE #4875：/workspace 是流式 SSR，路由级加载壳（`loading.tsx` 的
     「工作区加载中」）与真壳内容会在转场窗口里同页共存数秒；侧栏 `data-state`
     首帧取服务端快照（窄窗判据服务端恒 false ⇒ 展开），客户端对账在数秒后才把
     同一节点翻转为收起。对账翻转若恰落在 React 换代提交窗口内，会短暂出现
     「SSR 展开代 + 客户端收起代」两棵 `[data-slot="sidebar"]`（GA 每日档实测
     strict mode violation、retry 通过）。所以在 domcontentloaded 最早瞬间断言
     唯一性会撞上瞬态 —— 这里先等稳定态（数量收敛到 1、窄窗判据与生效态都到达
     按窗宽推导的终值），再放行后续断言；不放宽 strict mode。 */
  const expectedNarrow = width <= NAV_AUTO_COLLAPSE_MAX_PX;
  await expect
    .poll(
      async () => ({
        count: await sidebar.count(),
        narrow: await wrapper.getAttribute("data-narrow"),
        state: await sidebar.getAttribute("data-state"),
      }),
      { timeout: 20_000 },
    )
    .toEqual({
      count: 1,
      narrow: expectedNarrow ? "true" : "false",
      state: expectedNarrow ? "collapsed" : "expanded",
    });
  await expect(sidebar).toBeVisible();
  return {
    ctx,
    page,
    sidebar,
    wrapper,
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
