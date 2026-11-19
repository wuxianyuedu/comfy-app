import { expect, test } from "@playwright/test";

/**
 * 顶栏光暗切换（@critical）：jsdom 只钉「按当前档反向写回」，这里钉**真的落到文档上**——
 * `next-themes` 给 `<html>` 加/去 `dark` class，这条链路只有真浏览器能验（Provider、`suppressHydrationWarning`、CSS 变量回落）。
 * 另钉两处真出过问题的：按钮首帧就在且可点（图标常驻靠 CSS 决定可见性，改成条件渲染首帧可能没按钮）；翻过去还得能翻回来，否则用户只能进设置页。
 */
test.describe("顶栏光暗切换 @critical", () => {
  test("点一下翻档、再点一下翻回来，且按钮首帧就在", async ({ page }) => {
    await page.goto("/workspace");

    const toggle = page.getByRole("button", { name: "切换深浅色" });
    await expect(toggle).toBeVisible();
    await expect(toggle.locator("svg")).toHaveCount(2);

    const htmlClass = () => page.evaluate(() => document.documentElement.className);

    const before = await htmlClass();
    const wasDark = before.includes("dark");

    await toggle.click();
    await expect
      .poll(() => htmlClass(), {
        message: "点了之后 <html> 的 dark class 没变",
      })
      .not.toBe(before);
    const afterFirst = await htmlClass();
    expect(afterFirst.includes("dark")).toBe(!wasDark);

    await toggle.click();
    await expect.poll(() => htmlClass(), { message: "翻不回来 —— 只能进设置页改" }).toBe(before);
  });
});
