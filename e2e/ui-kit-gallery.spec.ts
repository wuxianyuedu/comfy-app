import { expect, test } from "@playwright/test";

/**
 * ISSUE #3525：UI 控件总览页（/ui-kit）的运行时守卫。
 *
 * 此前该页在浏览器里报三类错（tsc / build / 静态测试全都看不见）：
 *   1. button 套 button（OptionListPopover 的 trigger 塞了 <Button>）→ 无效 HTML → 水合失败；
 *   2. NavigationMenuTrigger render 成 <Link>（锚点）却没关 nativeButton → base-ui 运行时不变量报错；
 *   3. CodeBlock 高亮 `bash` 但 shiki 预载语言表没有 bash → ShikiError。
 * 本用例把「真实浏览器里零 console error / 零未捕获异常」变成门禁：这正是静态检查
 * 覆盖不到的那一档（水合只在 DOM 里发生，shiki 语言是动态 import 后才校验）。
 * 标 @critical：控件页是全部基元的陈列面，它水合失败意味着同样的坑也会埋在生产页面里。
 */
test.describe("UI 控件总览", () => {
  test("@critical /ui-kit 渲染完整且浏览器控制台零报错", async ({ page }) => {
    const consoleErrors: Array<string> = [];
    const pageErrors: Array<string> = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/ui-kit");

    // 页面骨架：标题与三段代表分区都真实渲染（文案来自 ui-kit-gallery*.tsx）
    await expect(page.getByRole("heading", { name: "UI 控件总览" })).toBeVisible();
    await expect(page.getByText("按钮、徽标与状态件").first()).toBeVisible();
    await expect(page.getByText("数据展示与杂项").first()).toBeVisible();

    // 主体控件交互可用：主题开关翻面不抛错（顺带覆盖 next-themes 链路）
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await page.getByRole("button", { name: "深色", exact: true }).click();

    expect(pageErrors, "未捕获的页面异常").toEqual([]);
    expect(consoleErrors, "浏览器 console error").toEqual([]);
  });
});
