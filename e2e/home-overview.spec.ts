import { expect, test } from "@playwright/test";

/**
 * 首页两块新卡片的浏览器核对（@critical）。
 *
 * 这里**不**判「有几个模型」「哪条项目排第一」—— 那些数据走的是批量 tRPC 查询，
 * `route.fulfill` 喂不进客户端（同 `e2e/model-library.spec.ts` 头部记的实测：
 * 单对象、数组、下标对象三种形状都不落地）。拿一个喂不进去的桩去断言内容，
 * 只会得到一个恒真的空判据。
 *
 * 能判、且判得动的三件事：
 *   ① 两块卡都装配起来了（标题在、位置在）；
 *   ② 概览卡必须说出三种状态之一（骨架 / 读不到 / 具体计数或「还没同步到」）——
 *      一块什么都不说的卡就是坏了；
 *   ③ 整屏零运行时错误（新组件最容易带出的是 hydration 与控制台报错，
 *      jsdom 那侧测不到这两样）。
 */
test.describe("首页概览区 @critical", () => {
  test("两块卡都在，概览卡对自己的状态有一句说法", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });

    await page.goto("/workspace");

    const compute = page.locator('[data-component="home-local-compute"]');
    const overview = page.locator('[data-component="home-model-overview"]');
    await expect(compute).toBeVisible();
    await expect(overview).toBeVisible();
    await expect(overview.getByText("模型概览")).toBeVisible();

    /* 三种状态之一：骨架（取数中）、一句失败说明、或有具体计数 / 「还没同步到」。
       一个都不命中就是这块坏了。 */
    await expect(
      overview
        .getByText(/模型计数暂时读不到|还没有同步到可用模型|\d+ 个/)
        .first()
        .or(overview.locator('[data-slot="skeleton"]').first()),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
