import { expect, test, type Page } from "@playwright/test";

import { stubTrpc } from "./support/trpc-stub";

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
 * 前三条走**真库、真服务**，数一数对不对得上，不桩数据（判据与机器上有什么数据无关）。
 * 第四条（位次方向）**必须喂指定数据** —— 后端按 `createdAt` 倒序回、视图要反一次，
 * 只有拿到「后提交的在前面」这个特定顺序才判得出来，真库里凑不出这个形状。
 *
 * 桩走 `./support/trpc-stub` 的 `stubTrpc()`：它按 `httpBatchStreamLink` 真正读的
 * **JSON Lines**（`trpc-accept: application/jsonl`）协议产出响应，而不是 JSON 数组
 * —— 数组形态喂不进去（ISSUE #1442 的现场，那份 helper 的文件头记了根因）。
 */

/**
 * 造一条 `task.list` 的行。字段照 `src/server/api/routers/task.ts` 的 `scanOnce`
 * 返回的那一份（不是 `QueueRow` —— 前者是**服务端载荷**，`createdAt` 在这里是
 * `Date`，由 superjson 过线后才被客户端还原成同一个类型）。
 */
function task(id: string, createdAt: string, workflowName: string) {
  return {
    id,
    type: "TXT2IMG",
    workflowName,
    status: "QUEUED",
    prompt: `提示词 ${id}`,
    createdAt: new Date(createdAt),
    cover: null,
    checkpoint: null,
    mediaType: "image",
    projectId: null,
    progress: 0,
    error: null,
  };
}

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

  /**
   * 位次方向：后端按 `createdAt` **倒序**回（后提交的在前面），而执行器是 FIFO
   * ——界面必须把这一列**反一次**，让最早提交的显示「第 1 位」。
   *
   * 这条是 ISSUE #1442 里点名的「最像『只有看屏幕才发现』的错误」：错了的话
   * 用户按界面上的「第 N 位」估算还要等几轮，方向一反就全反了，而单元层
   * （`use-queue-monitor.test.ts`）判不到真实渲染出来的那串文案。
   *
   * 数据形状专门造得能区分方向：三条的 `createdAt` 与名字一一对应
   * （`最早` → 最旧），`tasks` 数组按**后提交在前**排（与真服务端同序）。
   */
  test("位次按先入先出：后端倒序回、界面把最早提交的排第 1", async ({
    page,
  }) => {
    await stubTrpc(page, {
      "task.list": {
        tasks: [
          task("newest", "2026-01-01T00:00:03Z", "最后提交的"),
          task("middle", "2026-01-01T00:00:02Z", "中间提交的"),
          task("oldest", "2026-01-01T00:00:01Z", "最早提交的"),
        ],
        total: 3,
      },
    });

    await openQueue(page);
    await expect(waitingSection(page).locator("li")).toHaveCount(3);
    await expect(waitingSection(page).getByText("排队中（3）")).toBeVisible();

    /* 读**铺出来的顺序**（DOM 顺序），不是读某一条的文案 —— 判据正是「谁在前」。
       每行前面那个「第 N 位」是用户据以估算的读数，与行的位置必须一致。 */
    const rows = await waitingSection(page)
      .locator("li")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
    expect(rows.map((t) => /第 (\d+) 位/.exec(t)?.[1] ?? "?").join(",")).toBe(
      "1,2,3",
    );
    /* 最早提交的在最前面（方向反了时这里是「最后提交的」）。 */
    expect(rows[0]).toContain("最早提交的");
    expect(rows[0]).toContain("第 1 位");
    expect(rows[2]).toContain("最后提交的");
    expect(rows[2]).toContain("第 3 位");
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
