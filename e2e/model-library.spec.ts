import { expect, test } from "@playwright/test";

/**
 * 模型库在真浏览器里的冒烟（@critical）——挂的是 `studio/ModelLibrary`
 * （工作区管理版，ISSUE #2433 之后 /models 只此一份实现）。
 *
 * 只判**不依赖模型数据**的事。E2E 环境的模型库是空的（数据来自批量 tRPC 查询，
 * `route.fulfill` 喂不进客户端 —— 试过三种形状都不落地，记在旧版文件头的那堵墙；
 * 真端点在本机也返回空列表），而筛选排**有意只在有数据时渲染**（空库时它只剩
 * 孤零零一枚「全部 (0)」—— `ModelLibrary.tsx` 里那行注释），所以这里锚的是
 * 空库状态下仍然成立的形状：页头在、顶栏动作在、空态与它唯一的出口在、
 * 页面上不存在指向不存在路由的卡片链接。筛选档位的角色语义由 jsdom 侧
 * `studio/ModelLibrary.test.tsx` 承担 —— 它能桩数据，锚的是同一套 role。
 *
 * 此前这里断的是已退役的浏览版（筛选档位七枚 + 「同步模型」按钮）—— #2433
 * 换页没带 E2E 同批更新，而这一格的唯一执行者在每日档（§13.5.21），PR 上不跑，
 * 红被 stage-7 生产构建的红（#2464）遮了两晚才露出来（ISSUE #2486）。
 *
 * 「没有可用模型」与「有一堆模型」两种库状态下，死链那条都必须成立，所以它
 * 不写 if 分支 —— 分支型断言在另一支上会静默不跑。
 */
test.describe("模型库 @critical", () => {
  test("这一屏装配起来了：页头、顶栏动作与内容区（空态或筛选排）都在", async ({
    page,
  }) => {
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
    await expect(
      page.getByRole("button", { name: "模型目录配置" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "搜索模型名称" }),
    ).toBeVisible();

    /* 内容区的形状随库状态分两支，`or()` 让两支都写进断言、哪支在场判哪支
     * （不写 if —— 分支型断言在另一支上会静默不跑）：
     *   · 空库 ⇒ 空态（说「为什么空」）+「去配置目录」出口（同步走后台自动，
     *     没有「同步模型」钮 —— 那是浏览版的形状，ISSUE #2486）；
     *   · 有数据 ⇒ 筛选排（radiogroup「按类型筛选模型」，空库时它有意不渲染
     *     —— 空库只剩一枚「全部 (0)」，`ModelLibrary.tsx` 里那行注释）。 */
    await expect(
      page
        .getByText("模型库还没有内容")
        .or(page.getByRole("radiogroup", { name: "按类型筛选模型" })),
    ).toBeVisible();
  });

  test("页面上不存在指向 /models/xxx 的链接（那条路由不存在）", async ({
    page,
  }) => {
    await page.goto("/models");
    /* 有数据时卡片是按钮、没数据时压根没有卡 —— 两种库状态下这条都该成立。
     * `studio/ModelLibrary` 的卡片同样不下发 `/models/<id>` 链接
     * （jsdom 侧的对应断言随浏览版一起退役了，这条在真浏览器里接着守）。 */
    await expect(page.locator('a[href^="/models/"]')).toHaveCount(0);
  });
});
