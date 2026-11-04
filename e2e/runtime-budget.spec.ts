import { expect, test } from "@playwright/test";

import { collectSamples, summarize, DISCARD_ROUNDS, ROUNDS } from "./support/runtime-budget";
import { expectHomeReady } from "./support/home-anchors";

/**
 * 「页面级运行时性能」基线判据（ISSUE #1781 右半边，清单第 6 层另一半）。左半边 `check-bundle-budget.cjs` 判首屏下载多少，这条判下载之后跑多快：往客户端塞一段同步循环，`loadEventEnd` 稳态 `min` 由 318ms 抬到 349ms 而 bundle 一字节没变 —— 两者无替换关系。
 * 形态①：进「全量 e2e」那一档，不新增档 / 账 / `pnpm` 入口 —— 已有 `FRESHNESS_TRACKS` + `.on-demand-duties.json` + `freshness-gate.mjs`「每档都有主」的通道，而运行时断言要起 webServer + 浏览器、与全量 e2e 同笔开销，另开同形状的账正是 §12.12 / §12.18 要拦的；代价是只在那一跑里判。不进 pre-commit（比 `next build` 还贵，冷启动抖幅会变成随机红，成本判据 §13.5.4）。取数每轮开新 page、弃前 4 轮取 `min`（成因见 `e2e/support/runtime-budget.ts` 文件头）。
 * 阈值 = 基线 × 2，两端被实测钉住：跨批抖幅 FCP ±4.8% / `loadEventEnd` ±1.5%（下界十倍余量，不误报），最小可判剂量约 +31ms（≈ +10%）落在 2× 之内。基线按平台各自一份（ISSUE #1834 的 win32 读数：win32 715.5ms vs posix 320ms，`/workspace` 差 2.2×；共用则两宿主二选一恒红），darwin 未实测落 posix 档、真红了按 §13.5.4 补录。**判据不依赖业务数据**，其红只意味「主线程侧劣化」或「取数环境变了」，`expectHomeReady` 是唯一前置（`support/home-anchors`）。
 */
/* SAFETY: 类型断言已复核 */
const RUNTIME_BUDGET = {
  /**
   * 基线读数（毫秒）—— **实测初值，不是估的**，唯一出处是 `scripts/.runtime-budget-baseline.json` 的
   * `metric.byPlatform`（与 `check-bundle-budget` 同构：数字住在基线文件，spec 只读口径）。两平台必须
   * 同源有判据（`tests/e2e-runtime-budget.test.ts` 核逐字一致）—— 各写一份就会漂，而漂了不会红。
   */
  byPlatform: {
    win32: { loadEventEnd: 716, firstContentfulPaint: 344 },
    posix: { loadEventEnd: 320, firstContentfulPaint: 250 },
  },
  /** 阈值倍数：基线 × 这个数 = 上限（上面那段写了为什么是 2）。 */
  factor: 2,
} as const;

/** 本机跑在哪个平台的档上 —— 缺平台键时落 posix（见文件头「darwin 未实测」）。 */
const PLATFORM = process.platform === "win32" ? "win32" : "posix";

test.describe("页面级运行时读数在预算内", () => {
  /**
   * 首页是**唯一**被测路径，也是全仓 e2e 的公共锚点：不依赖登录态与 ComfyUI 后端，「渲染完了」有唯一
   * 口径（`expectHomeReady`），不是「等一个可能永远不来的东西」。换路径就要重录基线 —— 刻意不参数化成
   * 「多屏巡检」。
   */
  test("首页首屏读数（min / 弃前 4 轮）不超过基线的 2 倍", async ({ page, context }) => {
    /* 先用 Playwright 给的 `page` 等锚点：那一次导航同时把服务与缓存带进暖态，
     * 后面 12 轮才是真的在测「稳态」。 */
    await page.goto("/workspace");
    await expectHomeReady(page);

    /* 收数走 `context` 而不是这个 `page`（每轮新开一个 page）—— 成因见
     * `support/runtime-budget.ts` 的文件头：同一 page 反复导航时 FCP 结构性缺失。 */
    const samples = await collectSamples(context, "/workspace");
    const { loadEventEnd, firstContentfulPaint } = summarize(samples);

    /* 「读不到」与「超预算」是两件事，别混成一条断言：前者说明取数口径坏了，
     * 后者才是性能退化。混起来会让「判据自己坏了」表现成「性能红」。 */
    const roundsNote = `${ROUNDS} 轮、弃前 ${DISCARD_ROUNDS} 轮`;
    expect(
      firstContentfulPaint,
      `FCP 稳态读数缺失（${roundsNote}，含 null）—— 取数口径坏了，不是性能红`,
    ).not.toBeNull();
    expect(
      loadEventEnd,
      `loadEventEnd 稳态读数缺失（${roundsNote}，含 null）—— 取数口径坏了，不是性能红`,
    ).not.toBeNull();

    const budget = RUNTIME_BUDGET.factor;
    const baseline = RUNTIME_BUDGET.byPlatform[PLATFORM];
    const loadBudget = baseline.loadEventEnd * budget;
    const fcpBudget = baseline.firstContentfulPaint * budget;
    /* 两档读数一起打进断言消息：红了要能一眼看出超了多少，而不是只看到一句
     * 「expected 640 to be greater than 700」还要回来读源码。 */
    const detail =
      `读数：loadEventEnd ${loadEventEnd?.toFixed(1)}ms / FCP ${firstContentfulPaint?.toFixed(1)}ms` +
      `（${roundsNote} 取 min）；平台 ${PLATFORM} 的基线：${baseline.loadEventEnd}ms / ${baseline.firstContentfulPaint}ms` +
      `（×${budget} ⇒ 预算 ${loadBudget}ms / ${fcpBudget}ms）`;

    expect(loadEventEnd, `loadEventEnd 超出预算（${budget}× 基线）。${detail}`).toBeLessThanOrEqual(
      loadBudget,
    );
    expect(firstContentfulPaint, `FCP 超出预算（${budget}× 基线）。${detail}`).toBeLessThanOrEqual(
      fcpBudget,
    );
  });
});
