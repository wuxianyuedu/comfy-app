import { expect, test } from "@playwright/test";

/**
 * 顶栏光暗切换（@critical）。
 *
 * jsdom 那侧钉的是「按当前档反向写回」，这里钉的是**真的落到文档上**：
 * `next-themes` 走的是给 `<html>` 加/去 `dark` class，而这条链路只有真浏览器能验
 * （Provider、`suppressHydrationWarning`、CSS 变量回落都在它上面）。
 *
 * 顺带钉两件此前真出过问题的事：
 *   · 按钮在首帧就要存在且可点（两枚图标常驻、靠 CSS 决定可见性；若改成按
 *     `resolvedTheme` 条件渲染，首帧那颗按钮可能压根不在）；
 *   · 翻过去再翻回来，文档回到原状态 —— 单向能切、切不回来，用户就只能进设置页。
 */
test.describe("顶栏光暗切换 @critical", () => {
  test("点一下翻档、再点一下翻回来，且按钮首帧就在", async ({ page }) => {
    await page.goto("/workspace");

    const toggle = page.getByRole("button", { name: "切换深浅色" });
    await expect(toggle).toBeVisible();
    await expect(toggle.locator("svg")).toHaveCount(2);

    const htmlClass = () =>
      page.evaluate(() => document.documentElement.className);

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
    await expect
      .poll(() => htmlClass(), { message: "翻不回来 —— 只能进设置页改" })
      .toBe(before);
  });
});
