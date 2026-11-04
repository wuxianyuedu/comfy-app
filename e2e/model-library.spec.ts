import { expect, test } from "@playwright/test";

/**
 * 模型库真浏览器冒烟（@critical），挂 `studio/ModelLibrary`（ISSUE #2433 后 /models 只此一份实现）。只判不依赖模型数据的事：E2E 库为空（批量 tRPC 查询喂不进 `route.fulfill`，真端点本机也空）。
 * 筛选排有意只在有数据时渲染，故只锚空库仍成立的形状；角色语义由 `studio/ModelLibrary.test.tsx` 判（能桩数据、同一套 role）。#2433 换页漏更 E2E，红被 #2464 遮两晚（ISSUE #2486）。
 * 死链断言不写 if —— 分支型断言在另一支上会静默不跑。
 */
test.describe("模型库 @critical", () => {
  test("这一屏装配起来了：页头、顶栏动作与内容区（空态或筛选排）都在", async ({ page }) => {
    await page.goto("/models");
    /* 页头名字**只有一处能改**：注册表 `NavItems.tsx` 里这一项
     * `label: "模型"`（`viewLabel` 缺省），`pageHeaderTitle()` 出的就是它。
     * 此前这里写「模型库」——那是路由 `metadata.title`（浏览器标签题）里的字，
     * 不是 `h1` 里的字。判据锚在注册表口径上，由
     * `tests/page-name-single-source.test.ts` 守着（ISSUE #1423）。 */
    await expect(page.getByRole("heading", { name: "模型" })).toBeVisible();

    /* 顶栏动作（`ViewActions`；本页不在 AppShell 里，它退化成屏内右对齐一行）：
     * 目录配置入口与搜索框。空库与有数据两种状态下这两颗**都在** —— 找不到
     * 目录是配置问题，入口不能跟着数据一起消失。 */
    await expect(page.getByRole("button", { name: "模型目录配置" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "搜索模型名称" })).toBeVisible();

    /* 内容区的形状随库状态分两支，`or()` 让两支都写进断言、哪支在场判哪支（不写 if —— 分支型断言在另一支会静默不跑）：
     *   · 空库 ⇒ 空态 +「去配置目录」出口（同步走后台自动，没有「同步模型」钮 —— 那是浏览版的形状，ISSUE #2486）；
     *   · 有数据 ⇒ 筛选排（radiogroup「按类型筛选模型」，空库时它有意不渲染 —— 只剩一枚「全部 (0)」）。 */
    await expect(
      page
        .getByText("模型库还没有内容")
        .or(page.getByRole("radiogroup", { name: "按类型筛选模型" })),
    ).toBeVisible();
  });

  test("页面上不存在指向 /models/xxx 的链接（那条路由不存在）", async ({ page }) => {
    await page.goto("/models");
    /* 有数据时卡片是按钮、没数据时压根没有卡 —— 两种库状态下这条都该成立。
     * `studio/ModelLibrary` 的卡片同样不下发 `/models/<id>` 链接
     * （jsdom 侧的对应断言随浏览版一起退役了，这条在真浏览器里接着守）。 */
    await expect(page.locator('a[href^="/models/"]')).toHaveCount(0);
  });
});
