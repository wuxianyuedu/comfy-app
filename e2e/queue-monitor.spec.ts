import { expect, test, type Page } from "@playwright/test";

/**
 * 队列与运行屏在真浏览器里的样子（@critical）。
 *
 * 为什么值得单独一份（jsdom 那几份判不到）：
 *   · **标题里的数与下面真的铺出来的行数必须一致** —— `排队中（N）` 与 `<li>` 数量
 *     对不上，是那种「用户据此决定要不要再提交一条」时最伤的错误，而它只在真渲染里出现；
 *   · **每 2 秒的重读真的在发请求**：`refetchInterval` 是运行时行为，jsdom 里定时器
 *     不跑网络；
 *   · 三段的主干顺序（跑动中 → 排队中 → 最近结果）在真 DOM 里成立。
 *
 * 刻意不桩数据。桩过，而且桩不通：`route.fulfill` 打给
 * `/api/trpc/task.list?batch=1` 的响应**到不了客户端** —— 四种信封形状（数组一行、
 * 数组+换行、索引对象、索引对象+换行，都按真服务端录下来的 superjson 结构逐字段对齐）
 * 行为完全一致，而**负控制**（返回一段坏 JSON）与它们也完全一致：屏面照旧、控制台
 * 零报错、`loggerLink` 照样打 `<< query`。也就是说问题不在形状，在这条路上 fulfill
 * 根本不被消费。顺带一条事实：`e2e/critical-flows.spec.ts` 里那份 `stubBackend`
 * 同样喂不进数据 —— 它只让界面不卡住，不改变任何一行内容；那份文件里的断言也确实
 * 没有依赖数据，所以没暴露。桩不通的根因留给后续（见本次 PR 描述）。
 *
 * 所以这里只判**与机器上有什么数据无关**的不变量：拿真库、真服务跑，数一数对不对得上。
 */

const runningSection = (page: Page) =>
  page.locator('section[aria-labelledby="queue-running-heading"]');
const waitingSection = (page: Page) =>
  page.locator('section[aria-labelledby="queue-waiting-heading"]');

async function openQueue(page: Page) {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "队列", exact: true }).first().click();
  await expect(waitingSection(page)).toBeVisible();
}

/** 从「排队中（N）」这类标题里取出那个数。 */
async function headingCount(section: ReturnType<typeof waitingSection>) {
  const heading = (await section.getAttribute("aria-labelledby")) ?? "";
  const text = await section.page().locator(`#${heading}`).innerText();
  const matched = /（(\d+)）/.exec(text);
  return matched ? Number(matched[1]) : Number.NaN;
}

test.describe("队列与运行屏 @critical", () => {
  test("「排队中（N）」里的数与铺出来的行数一致（含 0 的空态）", async ({
    page,
  }) => {
    await openQueue(page);

    /* 只有这一段带计数：跑动中是单张卡、最近结果的标题不带数。所以这里判的是
       「文案里的数与实际行数」这一对，而不是三段各判一次 —— 对不上就是用户看到
       「3 条在排」而下面只铺了两行（或反过来）。0 也要判：空态铺的是说明文字、
       不许留下半个 `<li>`。 */
    const declared = await headingCount(waitingSection(page));
    expect(
      Number.isNaN(declared),
      "标题里读不到那个数：文案改了，这条判据要跟着改，不能静默失效",
    ).toBe(false);
    await expect(waitingSection(page).locator("li")).toHaveCount(declared);
  });

  test("跑动中最多一张卡（多个 RUNNING 也不许叠成两屏）", async ({ page }) => {
    await openQueue(page);
    const cards = await runningSection(page).locator("article").count();
    expect(
      cards,
      "跑动中铺了多张卡：同一时刻只该有一处在跑的那张被表达",
    ).toBeLessThanOrEqual(1);
  });

  test("三段按「跑动中 → 排队中 → 最近结果」的顺序铺，且各有一段自己的名字", async ({
    page,
  }) => {
    await openQueue(page);

    const ids = await page
      .locator("main section[aria-labelledby]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("aria-labelledby")),
      );
    expect(ids).toEqual([
      "queue-running-heading",
      "queue-waiting-heading",
      "queue-recent-heading",
    ]);
  });

  test("每 2 秒的重读真的在发请求（不是一次性快照）", async ({ page }) => {
    let listCalls = 0;
    page.on("request", (req) => {
      if (req.url().includes("task.list")) listCalls += 1;
    });

    await openQueue(page);
    /* 首帧一次 + 每 2s 一次：12 秒的窗口里至少该看到 3 次。少于这个数就是
       `refetchInterval` 没生效 —— 屏面会停在某一帧上，而用户看不出来。 */
    await expect
      .poll(() => listCalls, {
        message: "队列屏没有按节奏重读",
        timeout: 12_000,
        intervals: [500],
      })
      .toBeGreaterThanOrEqual(3);
  });
});
