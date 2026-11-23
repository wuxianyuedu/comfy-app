import { expect, test } from "@playwright/test";

import { expectHomeReady } from "./support/home-anchors";

/**
 * 冒烟用例：不依赖 ComfyUI 后端，也不需要登录态。
 * 选择器文本来自 src/components/studio/HomePage.tsx 的真实文案。
 */

test.describe("首页冒烟", () => {
  test("@critical 首页停在 / 直接渲染创作台，不改写地址（#4881）", async ({ page }) => {
    await page.goto("/");

    // src/app/page.tsx 复用 workspace 页面实现，不再 redirect("/workspace")：
    // URL 停在 /（首页地址不拼 workspace）。
    await expect(page).toHaveURL(/\/$/);

    /* 创作台首屏（无需登录、不依赖 ComfyUI 后端）。
     * 锚点是四张入口卡里的第一张 —— 首页那块欢迎区已按 ISSUE #1691 移除，
     * 这里改用「用户进首页第一眼要看的那件事」，口径见 `support/home-anchors`。 */
    await expectHomeReady(page);
  });
});

test.describe("数据库链路冒烟", () => {
  /**
   * ISSUE #489：CI 门禁此前**从不建库**，且 `db:push` 在无 TTY 上会「报错 + exit 0 + 留 0 字节库」。
   * `/api/health` 现一并探 schema 就绪度（`SELECT 1` 空库照样成功，光靠它会把「表没建」漏报成
   * `db: up`），故断言 `db: "up"` 等价于「表真的建好了」；它依赖 CI 里 `pnpm run db:push` 那步先跑过。
   */
  test("@critical 健康检查确认数据库表已就绪", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body: unknown = await res.json();
    // 表没建时是 503 + db: "empty"（此时应用首页还能 200，正是此前被漏报的形态）
    expect(body).toEqual(expect.objectContaining({ status: "ok", db: "up" }));
  });
});
