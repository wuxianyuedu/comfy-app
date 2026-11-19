import { expect, test } from "@playwright/test";

/**
 * 模型库真浏览器冒烟（@critical），挂 `studio/ModelLibrary`（ISSUE #2433 后 /models 只此一份实现）。
 * 只判不依赖模型数据的事：E2E 库为空（批量 tRPC 查询喂不进 `route.fulfill`，真端点本机也空）。
 * 左侧目录列与类型筛选 chip **都**只在有数据时渲染（#3368：chip 整排退役、目录列由已同步的模型派生），
 * 故只锚空库仍成立的形状；有数据那支的角色语义由 `studio/ModelLibrary.integration.test.tsx` 判
 * （能桩数据、同一套 role）。#2433 换页漏更 E2E、#3368 改版漏更 E2E 各红过一次
 * （ISSUE #2486 / #3435）—— 改这一屏的顶栏与空态时，这一份要在同一批里跟上。
 * 死链断言不写 if —— 分支型断言在另一支上会静默不跑。
 */
test.describe("模型库 @critical", () => {
  test("这一屏装配起来了：页头、顶栏动作与内容区（空态或模型列表）都在", async ({ page }) => {
    await page.goto("/models");
    /* 页头名字**只有一处能改**：注册表 `NavItems.tsx` 里这一项
     * `label: "模型"`（`viewLabel` 缺省），`pageHeaderTitle()` 出的就是它。
     * 此前这里写「模型库」——那是路由 `metadata.title`（浏览器标签题）里的字，
     * 不是 `h1` 里的字。判据锚在注册表口径上，由
     * `tests/page-name-single-source.test.ts` 守着（ISSUE #1423）。 */
    await expect(page.getByRole("heading", { name: "模型" })).toBeVisible();

    /* 顶栏动作（`ViewActions`；本页不在 AppShell 里，它退化成屏内右对齐一行）：
     * 搜索框。它不是「跟着数据一起消失」的那种控件 —— 空库与有数据时都在
     * （`ModelLibrary.integration.test.tsx` 守着同一条）。
     * 「模型目录配置」入口在 #3368 随「目录全部默认启用」整段退役，这里不再锚它：
     * 锚一颗已不存在的按钮，就是这次 E2E 红的那个形状本身。 */
    await expect(page.getByRole("textbox", { name: "搜索模型名称" })).toBeVisible();

    /* 内容区的形状随库状态分两支，`or()` 让两支都写进断言、哪支在场判哪支
     * （不写 if —— 分支型断言在另一支会静默不跑）。空库这一支按**真实原因**分档
     * （#3368）：没配 ComfyUI 路径 ⇒ 「ComfyUI 还没有配置」+「去设置」出口；
     * 配了但没有模型 ⇒ 「模型库里还没有模型」。有数据那一支 = 模型文件列表
     * （`role="list"`，列表本身虚拟滚动，只有视口内的行进 DOM）。 */
    await expect(
      page
        .getByText("ComfyUI 还没有配置")
        .or(page.getByText("模型库里还没有模型"))
        .or(page.getByRole("list", { name: "模型文件列表" })),
    ).toBeVisible();
  });

  test("页面上不存在指向 /models/xxx 的链接（那条路由不存在）", async ({ page }) => {
    await page.goto("/models");
    /* 有数据时行是列表项、没数据时压根没有行 —— 两种库状态下这条都该成立。
     * `studio/ModelLibrary` 的行同样不下发 `/models/<id>` 链接
     * （jsdom 侧的对应断言随浏览版一起退役了，这条在真浏览器里接着守）。 */
    await expect(page.locator('a[href^="/models/"]')).toHaveCount(0);
  });
});
