import { expect, test } from "@playwright/test";

/**
 * 模型库在真浏览器里的冒烟（@critical）。
 *
 * 只判**不依赖模型数据**的事：这一屏装配起来了、筛选档位齐不缺、页面上不再存在
 * 指向不存在路由的卡片链接。「没有可用模型」与「有一堆模型」两种库状态下这两条
 * 都必须成立，所以不写 if 分支 —— 分支型断言在另一支上会静默不跑。
 *
 * 为什么没有「点卡片开详情」这条：这一屏的数据来自**批量** tRPC 查询（URL 形状是
 * `/api/trpc/model.list,model.list?batch=1`，两个调用者共用一批），而 `route.fulfill`
 * 喂不进客户端。实测试过三种形状都不落地，记在这里免得重复试：
 *   · 单对象 `{result:{data:{json}}}` → 卡片 0；
 *   · 数组、长度 = 批内调用数 → 卡片 0；
 *   · 下标对象 `{0:…,1:…}` → 卡片 0。
 * 真端点在本机也返回空列表（库里没有 `isAvailable=true` 的行），所以「看到空列表」
 * 不能用来证明桩生效。与队列屏 e2e 卡住的是同一堵墙。
 *
 * 卡片 → 详情这条接线由 jsdom 那侧守着，而且守得更硬：
 *   `ModelCard.test.tsx` 断言渲染结果里不存在 `a[href^="/models/"]`（那条路由从来
 *   不存在，此前每张卡都是 404），并断言点卡片会把这一条模型交出去；
 *   `ModelLibrary.test.tsx` 断言点「放大」下发 `UPSCALE`、点卡片后弹窗里是**这一条**
 *   的文件名与「不知道」的基座。
 */
test.describe("模型库 @critical", () => {
  test("这一屏装配起来了，且筛选档位里「放大」在", async ({ page }) => {
    await page.goto("/models");
    await expect(page.getByRole("heading", { name: "模型库" })).toBeVisible();

    /* 「放大」此前只存在于类型标签表、筛选档位里没有它 —— 那一类模型看得见却筛不出来。
       档位由标签表派生之后它才出现在界面上。逐档点名，少一档即红。 */
    for (const label of [
      "全部",
      "大模型",
      "LoRA",
      "控制网",
      "VAE",
      "嵌入",
      "放大",
    ]) {
      await expect(
        page.getByRole("button", { name: label }),
        `缺筛选档位「${label}」`,
      ).toBeVisible();
    }
  });

  test("页面上不存在指向 /models/xxx 的链接（那条路由不存在）", async ({
    page,
  }) => {
    await page.goto("/models");
    /* 有数据时卡片是按钮、没数据时压根没有卡 —— 两种库状态下这条都该成立。 */
    await expect(page.locator('a[href^="/models/"]')).toHaveCount(0);
    /* 「同步模型」这一出口恒在：空库时它是用户唯一能做的事。 */
    await expect(page.getByRole("button", { name: "同步模型" })).toBeVisible();
  });
});
