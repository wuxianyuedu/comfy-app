import { expect, test, type Page } from "@playwright/test";

/**
 * 视图页签条在真浏览器里的行为（@critical）。
 *
 * 这里判的是「装配 + 交互」这一层，jsdom 那侧替代不了：页签状态挂在 workspace 页面、
 * 侧栏导航要真的把它推起来、关闭要真的落回左邻。
 *
 * 顺带钉一条边界：浏览器/dev 形态下**没有** iframe 页签栏（可访问名「应用页签」），
 * 那是桌面壳才有的东西（ComfyUI 在浏览器里改由新浏览器页签打开）。视图页签条叫
 * 「已打开的视图」，两者不是一个控件，名字也不能混 —— 混了这条判据就废了。
 */
async function openWorkspace(page: Page) {
  await page.goto("/workspace");
  const strip = page.getByRole("tablist", { name: "已打开的视图" });
  await expect(strip).toBeVisible();
  return strip;
}

test.describe("视图页签条 @critical", () => {
  test("起步只有首页一页，且首页那一页没有关闭按钮", async ({ page }) => {
    const strip = await openWorkspace(page);
    const tabs = strip.getByRole("tab");
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toContainText("首页");
    await expect(strip.getByRole("button", { name: /^关闭 / })).toHaveCount(0);
  });

  test("侧栏切视图会多出一页并高亮；再点同一项是聚焦而不是开第二页", async ({
    page,
  }) => {
    const strip = await openWorkspace(page);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(strip.getByRole("tab").nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
  });

  test("关掉当前页落到左邻，关不掉首页", async ({ page }) => {
    const strip = await openWorkspace(page);
    await page.getByRole("button", { name: "模型", exact: true }).first().click();
    await page.getByRole("button", { name: "历史", exact: true }).first().click();
    await expect(strip.getByRole("tab")).toHaveCount(3);

    await strip.getByRole("button", { name: "关闭 历史" }).click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    /* 落左邻：历史右侧没有东西，左邻就是「模型」那一页。 */
    await expect(strip.getByRole("tab").nth(1)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(strip.getByRole("tab").nth(1)).toContainText("模型");
  });

  test("「+」能开一页；浏览器形态下不存在 iframe 页签栏", async ({ page }) => {
    const strip = await openWorkspace(page);
    await strip.getByRole("button", { name: "新页签", exact: true }).click();
    const item = page.getByRole("menuitem", { name: "队列", exact: true });
    await expect(item).toBeVisible();
    await item.click();
    await expect(strip.getByRole("tab")).toHaveCount(2);
    await expect(strip.getByRole("tab").nth(1)).toContainText("队列");

    /* 定位一律 exact：`name` 默认是非精确匹配，页签上的关闭按钮可访问名是
   「关闭 模型」这种包含式写法，不 exact 就会先命中它 —— 这条我自己踩过。 */
/* 这条栏是「已打开的视图」；「应用页签」属于桌面壳的 iframe 栏，浏览器里没有。 */
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(
      0,
    );
  });
});
