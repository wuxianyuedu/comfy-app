import { expect, test } from "@playwright/test";

import { collectSamples, summarize, DISCARD_ROUNDS, ROUNDS } from "./support/runtime-budget";
import { expectHomeReady } from "./support/home-anchors";

/**
 * 「页面级运行时性能」的基线判据（ISSUE #1781 的右半边：清单第 6 层的另一半）。
 *
 * ## 为什么这条不是 #1781 左半边的重复
 *
 * 左半边（`check-bundle-budget.cjs`）判的是**首屏要下载多少**；这一条判的是
 * **下载完之后跑得多快**。无替换关系，实测过：往客户端塞一段同步循环，
 * `loadEventEnd` 稳态 `min` 从 318ms 抬到 349ms，而 bundle 一个字节没变。
 *
 * ## 它搭哪班车（形态 ①）
 *
 * **进「全量 e2e」那一档，不新增档、不新增账、不新增 `pnpm` 入口。** 理由不是省事：
 * 本仓已有 `FRESHNESS_TRACKS` 的 `e2e` 档 + `.on-demand-duties.json` +
 * `freshness-gate.mjs` 的「每档都有主」这条完整通道，而运行时断言**天然属于这一档**
 * —— 它要起 webServer + 浏览器，与全量 e2e 是同一笔开销；另开一条同形状的账正是
 * §12.12 / §12.18 要拦的。代价是它只在「全量 e2e」那一跑里判，与功能用例同生共死。
 *
 * **不进 pre-commit**：它比 `next build` 还贵，且冷启动抖幅会直接变成提交时的随机红。
 * 成本判据同 §13.5.4。
 *
 * ## 取数口径
 *
 * 每轮开新 page、弃前 4 轮取 `min` —— 口径的成因（同一 page 那条路上 FCP 结构性
 * 取不到）与逐条实测读数全在 `e2e/support/runtime-budget.ts` 的文件头，这里不重述。
 *
 * ## 阈值怎么来的（不是拍的）
 *
 * 实测跨批抖幅：FCP 稳态 `min` **±4.8%**、`loadEventEnd` 稳态 `min` **±1.5%**。
 * 阈值取**基线 × 2**，它在两端都被实测钉住：
 *   · 下界：±4.8% 的抖幅离 2× 有十倍余量（不会误报）；
 *   · 上界：灵敏度实测里最小的可判剂量（约 +31ms，≈ +10%）落在 2× 之内 ——
 *     「小到看得见」与「大到不误报」之间那段阈值才是有用的。
 *
 * 红了先读数是哪一档、再决定压回去还是走例外流程（例外流程写在规范 §13.5.4）。
 *
 * ## 基线按平台各自一份（2026-10-13，ISSUE #1834 收尾的 win32 读数）
 *
 * win32 与 posix 的稳态读数差 **2.2×**（715.5ms vs 320ms，`/workspace`）。共用一个
 * 基线的下场是两种宿主二选一恒红：posix 的数让 win32 每次都红（红的话术还在说
 * 「性能退化」），win32 的数让 posix 的预算翻倍、判据形同虚设。所以按
 * `process.platform` 读各自平台的基线 —— 与 ISSUE #1767「两个平台同一条形状」
 * 同一条理由：**判据必须在它跑得到的那种宿主上自证**。倍数（×2）两平台相同，
 * 相对灵敏度不因平台打折。
 *
 * darwin 未实测，落在 posix 档（macOS 与 Linux 同为本地 next + chromium）；
 * 真在 macOS 上红了，按 §13.5.4 的例外流程补录那一档，别去动别的平台的数。
 *
 * ## 边界
 *
 * 这条断言**不依赖任何业务数据**（只要首页渲染得出来），所以它的红只有一个含义：
 * 「主线程侧的劣化」或「取数环境变了」。别的 spec 红不要读成它也红 ——
 * `expectHomeReady` 是它唯一的前置，而那是全仓共用的那一枚锚点（`support/home-anchors`）。
 */
/* SAFETY: 类型断言已复核 */
const RUNTIME_BUDGET = {
  /**
   * 基线读数（毫秒）—— **实测初值，不是估的**。唯一出处是
   * `scripts/.runtime-budget-baseline.json` 的 `metric.byPlatform`（与
   * `check-bundle-budget` 同构：数字住在基线文件里，spec 只读口径）。
   *
   * 两平台必须同源有判据（`tests/e2e-runtime-budget.test.ts` 核逐字一致）——
   * 各写一份就会漂，而漂了不会红。
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
   * 首页是**唯一**被测路径，且它是全仓 e2e 的公共锚点：
   *   · 不依赖登录态、不依赖 ComfyUI 后端；
   *   · 「渲染完了」有唯一口径（`expectHomeReady`），不是「等一个可能永远不来的东西」。
   * 换路径就要重录基线 —— 所以刻意不参数化成「多屏巡检」。
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
