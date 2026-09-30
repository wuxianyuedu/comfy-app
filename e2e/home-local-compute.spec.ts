import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * 首页「本机算力」卡在真浏览器里的形态（@critical）。
 *
 * jsdom 那边（`LocalComputeCard.test.tsx`）钉的是组件分支；这里钉两件它替代不了的：
 *   ① 这张卡确实出现在 `/workspace` 的首页上（首页由 AppShell 组装，组件测不出装配）；
 *   ② 后端在线/离线两态在真实轮询链路（`comfy-stats-store` → `/api/comfy/stats` → hook →
 *      `ProgressBar`）里各自落成什么样的 DOM —— 特别是**离线时一根占用条都不该有**。
 *      「画 0% 冒充没数据」是这个界面最容易犯的错，也是唯一值得在浏览器层再判一次的。
 *
 * 单位与百分比都由真实格式化链路给出，这里只读 `aria-valuenow`（数值契约），不比像素、
 * 不录视觉基线（规范 §11.8：这类断言走 getComputedStyle / ARIA，不进基线库）。
 */
const GIB = 1024 * 1024 * 1024;

const CARD = '[data-component="home-local-compute"]';

/** 与 `ComfyStatsPayload` 同形：CUDA 逻辑口径 + nvidia-smi 物理口径 + 系统内存。 */
async function stubStats(page: Page, body: Record<string, unknown>) {
  await page.route("**/api/comfy/stats**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

test.describe("首页本机算力卡 @critical", () => {
  test("在线时三档占用条各有数值，设备名与「在线」徽标可见", async ({
    page,
  }) => {
    await stubStats(page, {
      online: true,
      gpuName: "NVIDIA GeForce RTX 4090",
      vramUsed: 2 * GIB,
      vramFree: 22 * GIB,
      vramTotal: 24 * GIB,
      smiVramUsed: 6 * GIB,
      smiVramTotal: 24 * GIB,
      ramUsed: 16 * GIB,
      ramTotal: 32 * GIB,
    });
    await page.goto("/workspace");

    const card = page.locator(CARD);
    await expect(card).toBeVisible();
    await expect(card.getByText("本机算力")).toBeVisible();
    await expect(card.getByText("在线")).toBeVisible();
    await expect(card.getByText("NVIDIA GeForce RTX 4090")).toBeVisible();

    /* 三根条：物理显存 25% → ComfyUI 显存 8% → 内存 50%（次序即口径描述符的次序）。 */
    await expect
      .poll(
        async () =>
          (
            await card
              .locator('[role="progressbar"]')
              .evaluateAll((els) =>
                els.map((el) => el.getAttribute("aria-valuenow")),
              )
          ).join(","),
        { message: "占用条没按口径次序拿到三个百分比" },
      )
      .toBe("25,8,50");

    /* 两条显存口径必须都在场且各自有名 —— 合并成一根「显存」就是撒谎。 */
    await expect(card.getByText("显存", { exact: true })).toBeVisible();
    await expect(card.getByText("显存·ComfyUI")).toBeVisible();
    await expect(card.getByText("内存")).toBeVisible();
  });

  test("离线时一根占用条都不画，正文说明未运行", async ({ page }) => {
    await stubStats(page, {
      online: false,
      vramUsed: 0,
      vramFree: 0,
      vramTotal: 0,
      ramUsed: 0,
      ramTotal: 0,
    });
    await page.goto("/workspace");

    const card = page.locator(CARD);
    await expect(card.getByText("本机算力")).toBeVisible();
    await expect(card.getByText("离线")).toBeVisible();
    await expect(
      card.getByText("ComfyUI 未运行，显存/内存暂不可用"),
    ).toBeVisible();
    /* 关键判据：读不到 = 不画，而不是画成 0%。 */
    await expect(card.locator('[role="progressbar"]')).toHaveCount(0);
  });
});
