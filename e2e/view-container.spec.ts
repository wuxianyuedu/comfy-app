import { expect, test, type Page } from "@playwright/test";

/**
 * 统一容器在真浏览器里的宽度账（@critical）。
 *
 * 这一刀承诺的是「收口，不改视觉」，所以判据必须落在**计算样式**上：三档宽度在
 * 产物里解析成的像素值，要和收口前散在八个视图里的那三个数逐一对上。
 * 只判「渲染出了 data-view-container」等于什么都没判 —— 类名拼错、档位没生成、
 * 令牌没发射，都能让属性在那儿而宽度是 `none`。
 *
 * 顺带判一件事：文档型容器内**恰好一层**纵向滚动条。多一层就是双层滚动
 * （整屏滚 + 内层滚），是这次要修的病形之一。
 */
const column = (page: Page) =>
  page
    .locator('[data-view-container="document"] [class*="overflow-y-auto"] > div')
    .first();

async function maxWidthOf(page: Page): Promise<string> {
  const el = column(page);
  await expect(el).toBeVisible();
  return el.evaluate((node) => getComputedStyle(node).maxWidth);
}

test.describe("统一容器的宽度账 @critical", () => {
  test("首页落在 narrow = 960px，且容器内只有一层滚动", async ({ page }) => {
    await page.goto("/workspace");
    const frame = page.locator('[data-view-container="document"]');
    await expect(frame).toHaveCount(1);
    expect(await maxWidthOf(page)).toBe("960px");

    /* 滚动层由容器写死成唯一一层（`overflow-y-auto` 只出现在那里）。视图自己再套
       一层就是「整屏滚 + 内层滚」的双层滚动 —— 工坊屏原先正是那个形状。 */
    await expect(
      frame.locator('[class*="overflow-y-auto"]'),
    ).toHaveCount(1);
  });

  test("网格类屏落在 wide = 1200px（模型库）", async ({ page }) => {
    await page.goto("/workspace");
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    expect(await maxWidthOf(page)).toBe("1200px");
  });

  test("设置页的两栏壳用同一档位：medium = 1100px", async ({ page }) => {
    /* 设置页是「分区导航 + 内容」双栏壳，不并入 DocumentFrame，但它那个 1100 以前
       是自己写死的 —— 现在取同一颗令牌，所以这里判的是「数字只有一个家」。 */
    await page.goto("/settings");
    const shell = page.locator(".mx-auto.max-w-medium").first();
    await expect(shell).toBeVisible();
    expect(
      await shell.evaluate((node) => getComputedStyle(node).maxWidth),
    ).toBe("1100px");
  });
});
