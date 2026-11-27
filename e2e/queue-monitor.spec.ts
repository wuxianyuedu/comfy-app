import { expect, test, type Page } from "@playwright/test";

import { stubTrpc } from "./support/trpc-stub";

/**
 * 队列与运行屏在真浏览器里的样子（@critical）：标题里的数必须与真铺出的行数一致、每 2 秒的重读真在发请求、三段主干顺序在真 DOM 里成立 —— 这些 jsdom 判不到。
 * 位次方向那条必须喂指定数据：后端按 `createdAt` 倒序回、视图要反一次，真库凑不出这个形状。
 * 桩走 `./support/trpc-stub` 的 `stubTrpc()`，按 `httpBatchStreamLink` 真读的 **JSON Lines** 协议产出，数组形态喂不进去（ISSUE #1442）。
 */

/**
 * 造一条 `task.list` 的行。字段照 `src/server/api/routers/task.ts` 的 `scanOnce`
 * 返回的那一份（不是 `QueueRow` —— 前者是**服务端载荷**，`createdAt` 在这里是
 * `Date`，由 superjson 过线后才被客户端还原成同一个类型）。
 *
 * `queuePosition` 是位次的**唯一权威来源**（#5045）：视图直接渲染服务端给的
 * 「第 N 位」，不在前端按当前页重编号。喂指定数据的用例必须显式给这个字段，
 * 缺了它 DOM 上就是「第 undefined 位」（ISSUE #5153）。
 */
function task(id: string, createdAt: string, workflowName: string, queuePosition: number) {
  return {
    id,
    type: "TXT2IMG",
    workflowName,
    modelName: null,
    status: "QUEUED",
    prompt: `提示词 ${id}`,
    createdAt: new Date(createdAt),
    finishedAt: null,
    claimedAt: null,
    queuePosition,
    cover: null,
    checkpoint: null,
    mediaType: "image",
    videoPath: null,
    projectId: null,
    progress: 0,
    error: null,
  };
}

/** 一条 `task.list` 响应的完整形状（无限查询消费 tasks / hasMore / nextScanCursor）。 */
function listPage(tasks: Array<ReturnType<typeof task>>) {
  return {
    tasks,
    hasMore: false,
    scanned: tasks.length,
    nextScanCursor: 0,
    total: tasks.length,
    statusCounts: {},
    todayCounts: {},
  };
}

/**
 * 队列屏挂载时会同时发出多个 tRPC 过程（`task.summary` 定时轮询、`task.list`
 * 分页、`generationControl.pauseState`、画布壳的 llm / sidebar / model 配置…）。
 * `httpBatchStreamLink` 把同一时刻的过程拼进一个批请求 URL，而 `stubTrpc` 的
 * 既有纪律是「批里只要有一个过程没 handler 就整条 continue」——那会让同批的
 * `task.list` 桩一起失效、退回真库空队列（ISSUE #5153：GA 上 `toHaveCount(3)`
 * 得到 0，本地偶发进 3 行却位次 undefined，都是同一批请求时序在作祟）。
 *
 * 因此把队列屏会发的过程**一次桩齐**：`task.list` 用 getter 按请求取值（重读
 * 才能拿到点「提前」之后的新队列序），其余给最小合法值（表述见各 router 的 query）。
 * @param listResult 每次 `task.list` 请求时的返回值（getter 每帧读一次）
 */
async function stubQueueScreen(
  page: Page,
  listResult: () => unknown,
  reorderResult: unknown = { ok: true, detail: "已提前到队首，下一轮就轮到它" },
) {
  const handlers: Record<string, unknown> = {
    "task.summary": { failedToday: 0, queued: 3, running: 0, succeededToday: 0 },
    "task.reorder": reorderResult,
    "generationControl.pauseState": { paused: false },
    "llm.configGet": { config: {} },
    "llm.modeContractsGet": { configured: false, contracts: {} },
    "model.configList": { folders: [], comfyReachable: false, comfyuiPathConfigured: false },
    "sidebar.tabConfigGet": { config: {}, projectDefaults: {} },
    "project.list": { projects: [] },
  };
  Object.defineProperty(handlers, "task.list", {
    enumerable: true,
    get: listResult,
  });
  return stubTrpc(page, handlers);
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
  const matched = /（(?<count>\d+)）/.exec(text);
  return matched ? Number(matched.groups?.count) : Number.NaN;
}

test.describe("队列与运行屏 @critical", () => {
  test("「排队中（N）」里的数与铺出来的行数一致（含 0 的空态）", async ({ page }) => {
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
    expect(cards, "跑动中铺了多张卡：同一时刻只该有一处在跑的那张被表达").toBeLessThanOrEqual(1);
  });

  test("三段按「跑动中 → 排队中 → 最近结果」的顺序铺，且各有一段自己的名字", async ({ page }) => {
    await openQueue(page);

    const ids = await page
      .locator("main section[aria-labelledby]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-labelledby")));
    expect(ids).toEqual(["queue-running-heading", "queue-waiting-heading", "queue-recent-heading"]);
  });

  /**
   * 位次方向：后端按 `createdAt` **倒序**回（后提交在前）、执行器是 FIFO，界面必须**反一次**，让最早提交的显示「第 1 位」——反了用户估算等待轮数就全错。
   * 正是 ISSUE #1442 点名「最像只有看屏幕才发现」的错误；单元层 `use-queue-monitor.test.ts` 判不到真实渲染的文案。
   * 数据形状造得能区分方向：三条 `createdAt` 与名字一一对应，`tasks` 按**后提交在前**排（与真服务端同序）。
   */
  test("位次按先入先出：后端倒序回、界面把最早提交的排第 1", async ({ page }) => {
    /* 服务端按 createdAt 倒序回（后提交在前），并给出完整队列位次：
     * queuePosition 是视图渲染「第 N 位」的唯一来源（#5045）。 */
    await stubQueueScreen(page, () =>
      listPage([
        task("newest", "2026-01-01T00:00:03Z", "最后提交的", 3),
        task("middle", "2026-01-01T00:00:02Z", "中间提交的", 2),
        task("oldest", "2026-01-01T00:00:01Z", "最早提交的", 1),
      ]),
    );

    await openQueue(page);
    await expect(waitingSection(page).locator("li")).toHaveCount(3);
    await expect(waitingSection(page).getByText("排队中（3）")).toBeVisible();

    /* 读**铺出来的顺序**（DOM 顺序），不是读某一条的文案 —— 判据正是「谁在前」。
       每行前面那个「第 N 位」是用户据以估算的读数，与行的位置必须一致。 */
    const rows = await waitingSection(page)
      .locator("li")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
    expect(rows.map((t) => /第 (?<count>\d+) 位/.exec(t)?.groups?.count ?? "?").join(",")).toBe(
      "1,2,3",
    );
    /* 最早提交的在最前面（方向反了时这里是「最后提交的」）。 */
    expect(rows[0]).toContain("最早提交的");
    expect(rows[0]).toContain("第 1 位");
    expect(rows[2]).toContain("最后提交的");
    expect(rows[2]).toContain("第 3 位");
  });

  /**
   * 提前执行：点排队行的「提前」后，服务端换序、列表重读，被点的那条要真的排到队首。
   * 桩用 getter 按请求取值 —— stubTrpc 每帧读一次 handler 表，这样才能让「重读」
   * 拿到点完之后的新队列序，判据才是「行序变化」而不是「按钮存在」。
   */
  test("点「提前」后被点的行排到队首", async ({ page }) => {
    const before = [
      task("newest", "2026-01-01T00:00:03Z", "最后提交的", 3),
      task("middle", "2026-01-01T00:00:02Z", "中间提交的", 2),
      task("oldest", "2026-01-01T00:00:01Z", "最早提交的", 1),
    ];
    /* 点「提前」后服务端换序：被提前的行 queuePosition 变 1、其余顺延。
     * getter 每帧读一次，让刷新拿到点完之后的新队列序与位次。 */
    const after = [
      { ...before[1]!, queuePosition: 1 },
      { ...before[2]!, queuePosition: 2 },
      { ...before[0]!, queuePosition: 3 },
    ];
    let moved = false;
    await stubQueueScreen(page, () => listPage(moved ? after : before));

    await openQueue(page);
    await expect(waitingSection(page).locator("li")).toHaveCount(3);
    const middleRow = waitingSection(page).locator("li").filter({ hasText: "中间提交的" });
    const moveUp = middleRow.getByRole("button", { name: "把这一条提前到队首" });
    await expect(moveUp).toBeVisible();
    moved = true;
    await moveUp.click();
    await expect(waitingSection(page).locator("li").first()).toContainText("中间提交的");
    await expect(waitingSection(page).locator("li").first()).toContainText("第 1 位");
  });

  test("每 2 秒的重读真的在发请求（不是一次性快照）", async ({ page }) => {
    /* #5045 起重读的对象是 `task.summary`（计数带 refetchInterval），`task.list`
     * 只在翻页 / 手动刷新时取数。判据要数的是真正在定时轮询的那个过程，否则
     * 断言会钉在一个已经不再轮询的接口上（ISSUE #5153）。 */
    let listCalls = 0;
    page.on("request", (req) => {
      if (req.url().includes("task.summary")) {
        listCalls += 1;
      }
    });
    await stubQueueScreen(page, () =>
      listPage([
        task("queued-1", "2026-01-01T00:00:01Z", "排队任务一", 1),
        task("queued-2", "2026-01-01T00:00:02Z", "排队任务二", 2),
        task("queued-3", "2026-01-01T00:00:03Z", "排队任务三", 3),
      ]),
    );

    await openQueue(page);
    /* 首帧一次 + 每 2s 一次：12 秒的窗口里至少该看到 3 次。少于这个数就是
       `task.summary` 的 `refetchInterval` 没生效 —— 屏面会停在某一帧上，而用户看不出来。 */
    await expect
      .poll(() => listCalls, {
        message: "队列屏没有按节奏重读",
        timeout: 12_000,
        intervals: [500],
      })
      .toBeGreaterThanOrEqual(3);
  });
});
