import { expect, test, type Page } from "@playwright/test";

/**
 * 控制台「常用命令」分组头的排布账（ISSUE #1902，@critical）。
 *
 * 为什么这条必须落在真浏览器上：出问题的是**布局**，而且是**静默**的那种 ——
 * 分组头里的折叠面板配了 `basis-full`，而它所在的那一行没有 `flex-wrap` 时，
 * `basis-full` 的语义从「独占下一行」变成「横着占满这一行」，于是 240px 的侧栏
 * 被面板整个吃掉，组名与分组说明只剩几十像素、中文按字竖排成一条一条的。
 * jsdom 不算样式、也不排版，这条在单测里永远是绿的（`ConsolePresetList.test.tsx`
 * 判的是折叠语义与 DOM 属性，判不到宽度）。
 *
 * 判据取**读数**而不是类名：类名判「写没写 `flex-wrap`」，而这里要问的是
 * 「组头有没有被挤成一条竖线」。所以量三件事：
 *   1. 组头（触发行）的宽度要接近侧栏宽度，不能塌成几十像素；
 *   2. 组头的高度不能失控 —— 竖排时一个 4 字标题就能撑到 100px 以上；
 *   3. 展开的那一组，面板要落在组头**下方**（这才是「向下展开」）。
 * 三条都是「用户看得见的结构」，改基元 / 改排布都不会误伤。
 */

async function openConsole(page: Page): Promise<void> {
  await page.goto("/workspace");
  await expect(
    page.getByRole("tablist", { name: "已打开的视图" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "控制台", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("tab", { name: /控制台/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("console-preset-list")).toBeVisible();
}

/** 可见那一屏里的预设列表（视图栈按下页签逐屏渲染，不活跃的带 `hidden`）。 */
const presetList = (page: Page) =>
  page.locator('[data-view]:not(.hidden) [data-testid="console-preset-list"]');

test.describe("控制台 · 常用命令分组头排布 @critical", () => {
  test("组头不被挤成竖线：宽度接近侧栏、高度在两行以内", async ({ page }) => {
    await openConsole(page);
    const list = presetList(page);
    const listWidth = (await list.boundingBox())!.width;

    const headers = page.locator(
      '[data-view]:not(.hidden) [data-slot="disclosure-trigger"]',
    );
    const count = await headers.count();
    expect(count).toBeGreaterThan(3);

    for (let i = 0; i < count; i += 1) {
      const box = (await headers.nth(i).boundingBox())!;
      /* 组头要么与列表同宽（`flex-wrap` 正常换行时触发开关会短一点 —— 条数
         占掉右侧十来像素），要么至少是列表宽度的一半以上。塌成几十像素就是
         「面板横着占满整行」那个病。 */
      expect(
        box.width,
        `第 ${i + 1} 个组头只有 ${box.width}px 宽（列表 ${listWidth}px）—— 面板把整行吃掉了`,
      ).toBeGreaterThan(listWidth * 0.5);
      /* 竖排时一个 4 字标题就能撑到 100px 以上；正常的「组名 + 两行说明」
         封顶在 70px 上下。给到 80 留一点字体差异的余地，但仍能拦住竖排。 */
      expect(
        box.height,
        `第 ${i + 1} 个组头高 ${box.height}px —— 文字多半在按字竖排`,
      ).toBeLessThan(80);
    }
  });

  test("展开的那一组落回组头下方（向下展开，不是横着铺）", async ({ page }) => {
    await openConsole(page);
    const first = page
      .locator('[data-view]:not(.hidden) [data-slot="disclosure"]')
      .first();
    const trigger = first.locator('[data-slot="disclosure-trigger"]');
    const panel = first.locator('[data-slot="disclosure-panel"]');

    await expect(panel).toHaveAttribute("hidden", /.*/);
    await trigger.click();

    const t = (await trigger.boundingBox())!;
    const p = (await panel.boundingBox())!;
    expect(p.y, "面板没有落在组头下方").toBeGreaterThanOrEqual(t.y + t.height - 2);
    /* 面板宽度要撑满列表：它是「一整块内容」，不该被内容宽度挤窄。 */
    const listWidth = (await presetList(page).boundingBox())!.width;
    expect(p.width).toBeGreaterThan(listWidth * 0.8);
  });

  test("整列折起时七组一屏放得下（不再是一条滚不到底的流水账）", async ({
    page,
  }) => {
    await openConsole(page);
    const list = presetList(page);
    const { scrollHeight, clientHeight } = await list.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    /* 折起态下每组就是「组名 + 一行说明」。竖排时这个比值会到两倍以上
       （实测 1463 / 698）。这里只问「有没有明显超出」，不钉死像素。 */
    expect(
      scrollHeight,
      `折起时内容 ${scrollHeight}px 仍远高于可视 ${clientHeight}px`,
    ).toBeLessThan(clientHeight * 1.5);
  });
});
