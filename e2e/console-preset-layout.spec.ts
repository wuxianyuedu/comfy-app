import { expect, test, type Page } from "@playwright/test";

/**
 * 控制台「常用命令」分组头的排布账（ISSUE #1902，@critical）。出问题的是布局且是静默失效：分组头面板配 `basis-full`，
 * 行上没有 `flex-wrap` 时「独占下一行」变「横着占满」，240px 侧栏被吃掉、中文按字竖排；jsdom 不算样式，单测永远绿
 * （`ConsolePresetList.test.tsx` 只判折叠语义）。故判读数而非类名：组头宽度近侧栏、高度不失控、展开面板落在组头下方。
 */

async function openConsole(page: Page): Promise<void> {
  await page.goto("/workspace");
  await expect(page.getByRole("tablist", { name: "已打开的视图" })).toBeVisible();
  await page.getByRole("button", { name: "控制台", exact: true }).first().click();
  await expect(page.getByRole("tab", { name: /控制台/ })).toHaveAttribute("aria-selected", "true");
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

    const headers = page.locator('[data-view]:not(.hidden) [data-slot="disclosure-trigger"]');
    const count = await headers.count();
    expect(count).toBeGreaterThan(3);

    for (let i = 0; i < count; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
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
      expect(box.height, `第 ${i + 1} 个组头高 ${box.height}px —— 文字多半在按字竖排`).toBeLessThan(
        80,
      );
    }
  });

  test("展开的那一组落回组头下方（向下展开，不是横着铺）", async ({ page }) => {
    await openConsole(page);
    const first = page.locator('[data-view]:not(.hidden) [data-slot="disclosure"]').first();
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

  test("整列折起时七组一屏放得下（不再是一条滚不到底的流水账）", async ({ page }) => {
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
