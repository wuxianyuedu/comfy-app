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

  test("@critical 全部基元都能用滚轮看到（ISSUE #3798）", async ({ page }) => {
    await page.goto("/ui-kit");
    const scroller = page.locator('[data-slot="ui-kit-scroll"]');
    await expect(scroller).toBeVisible();

    /* 只断言「有 overflow-y-auto」是空的：容器没溢出时 scrollTop 恒为 0，
       而诉求正是「内容看不全」。先量内容真的比容器高，再滚到底看最后一节。 */
    const metrics = await scroller.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(metrics.scrollHeight, "内容应高于可视区").toBeGreaterThan(metrics.clientHeight);

    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    /* 真滚到底，不是只挪了一点：容器底与内容底对齐。 */
    const reachedBottom = await scroller.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
    );
    expect(reachedBottom, "滚动容器没能滚到内容底部").toBe(true);
    /* 最后一节真的落进视口 —— 判的是「看得全」，不是「有个 overflow 值」。
       只钉节标题会误判：滚到底时标题已被卷上去，但整节内容还在视口里。 */
    const lastSection = page.locator("section").filter({ hasText: "数据展示与杂项" }).last();
    await expect(lastSection).toBeInViewport();
  });
});
