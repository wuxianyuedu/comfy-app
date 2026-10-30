/**
 * 「页面级运行时性能读数」的**唯一落点**（规范 §11.8 / §13.5.4，ISSUE #1781 的右半边）。
 *
 * ## 它在守哪一格
 *
 * 清单第 6 层说「加 Lighthouse / Playwright 性能断言」，而它与第 1~5 层是两码事：
 * 前几层优化的是**首屏要下载多少**（bundle 体积，已由 `check-bundle-budget.cjs` 判），
 * 这一层判的是**下载完之后跑得多快**。两者无替换关系：体积全对而主线程被一段
 * 同步重计算打满时，只有这一条能看见（实测：客户端同步循环让 `loadEventEnd` 稳态
 * `min` 从 318ms 抬到 349ms，而 bundle 一个字节没变）。
 *
 * ## 取数形态：**每一轮开新 page** —— 这一条是被实测逼出来的，不是口味
 *
 * 最初按「同一个 page 反复 `goto`」写，结果 FCP **从第 2 轮起系统性缺失**：
 *
 * ```
 * i=0 docId=p2yxp type=navigate fcp=1 load=250
 * i=1 docId=fo8fe type=navigate fcp=0 load=73    ← 文档确实换了（docId 变了）
 * i=2 docId=bipux type=navigate fcp=0 load=119   ← 但 paint 条目不再产生
 * ```
 *
 * 用 `PerformanceObserver({type:"paint", buffered:true})` 在文档最早时机装 observer
 * 复验：**不是 buffer 被清、也不是读得太早** —— 那几轮浏览器**根本没有发**
 * `first-paint` / `first-contentful-paint` 这两个条目（observer 一条都没收到）。
 * 也就是说同一 page 上反复导航时，FCP 是**结构性取不到**的，不是竞态。
 *
 * 这同时解释了立案时那个反直觉读数：**裸 `min` 为什么看着特别稳** ——
 * 稳态段那几轮的 FCP 全是缺失的，`min` 只是没东西可算。
 *
 * 改成**每轮 `newPage()` + `close()`** 之后（同一 `browserContext`，保留缓存以贴合
 * 「同一个用户重复访问」的形态）：
 *   · FCP 12/12 轮全部有读数，**零缺失**；
 *   · 稳态 `min` 跨 4 批是 88 / 84 / 84 / 84 → **±4.8%**（比同一 page 那条路的
 *     ±5.2% 还紧，而且不再需要「拿不到就读成很快」的兜底）。
 *
 * ## 统计量：`min`（**弃前 N 轮**）
 *
 * 弃前 N 轮这条**不变**（它是页面的预热斜坡，不是可平滑的噪声）：实测每轮的第一、
 * 二次导航稳定偏高，第 5 轮起才进稳态。而 `max`（±20~23%）抓的是「这一次被什么
 * 挡住了」（flaky 的来源）、`p50`（±9~10%）把斜坡与稳态一起平均进去了 —— 都不用作判据。
 *
 * ⚠️ 与 `tools/measure-log-store.ts` 那句「墙钟读数漂移、做成断言只会造 flaky 红」
 * 的**取向相同、解法不同**：那是**进程内微基准**（`p50` 就够，它在暖进程里跑、
 * 没有斜坡这一层）；页面级多一层进程序启动 + 网络 + 渲染，所以口径是
 * 「弃前 N 轮 + `min`」，而不是「多跑几轮取平均」。
 *
 * ## 它抓不到什么（边界，别读成「后端也守住了」）
 *
 * 实测：**同样一段重计算放在 SSR 里，页面级读数完全看不见**。所以这个判据只能抓
 * **主线程 / 浏览器侧**的劣化。而清单第 2 层（xyflow 重渲染、zustand 全量订阅、
 * 日志流打满主线程）恰好全在这一侧 —— 口径因此是**对的**，但边界要写清：
 * 它不守「后端变慢」。
 *
 * 首屏实测 **0 个长任务**，所以不拿 `longtask` 当判据（它该盯的是日志面板那类
 * 重派生，ISSUE #1782 的场，不是首屏）。
 *
 * ## 与基线文件的分工
 *
 * 本文件是**取数口径**（怎么读、读几轮、怎么汇总）；阈值与实测初值在
 * `scripts/.runtime-budget-baseline.json`。两处分开是因为「口径」是代码事实、
 * 「阈值」是实测数字：阈值会随例外流程变，口径不该跟着动。
 *
 * @module e2e/support/runtime-budget — 运行时读数的取数口径（e2e 侧，不进 src 源码）
 */
import type { BrowserContext, Page } from "@playwright/test";

/**
 * 导航轮数：**每一轮都是一次真的「新开页面 + 导航」**，所以它同时是取数总成本。
 *
 * 12 与 4 这两个数来自立案实测（4 批 × 12 轮）：留 8 轮稳态读数足以让 `min` 落定，
 * 而弃 4 轮是实测出来的斜坡长度（第 5 轮起才稳）。**不写成「越大越准」** ——
 * 每多一轮就是一个新页面 + 一次导航，成本线性。
 */
export const ROUNDS = 12;

/**
 * 弃前几轮 —— 预热斜坡的长度（实测）。
 *
 * 与 `ROUNDS` 分开写：一个是成本、一个是斜坡，合成一句就没法在「轮数改了、
 * 斜坡没变」时保持口径。
 */
export const DISCARD_ROUNDS = 4;

/** 一次导航的读数（毫秒，相对 `navigationStart`）。 */
export interface NavigationSample {
  /** `navigation` 时序的 `loadEventEnd`。 */
  loadEventEnd: number;
  /** `paint` 时序里 `first-contentful-paint` 的 `startTime`。 */
  firstContentfulPaint: number;
}

/**
 * 在页面里读**当前这一次导航**的两个时序值。
 *
 * 必须每次导航之后现读：`performance` 的条目按导航重置，缓存住上一轮等于把
 * 「第一次导航」反复当基线用（那正是斜坡读数）。
 *
 * 拿不到就是 **`null`**，不给默认值 —— `loading` 未完成时 `loadEventEnd` 是 0，
 * 而 0 会被 `min` 当成「最快的一次」静默放行。FCP 缺失有实测的成因（见文件头），
 * 所以它同样必须能表达「没有」。
 */
export function readNavigationSample(page: Page): Promise<{
  loadEventEnd: number | null;
  firstContentfulPaint: number | null;
}> {
  return page.evaluate(() => {
    const nav = /* SAFETY: 类型断言已复核 */ performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      // `loadEventEnd` 在 load 未完成时是 0 —— 那是「还没有这个读数」，不是「0 毫秒」。
      loadEventEnd: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null,
      firstContentfulPaint: fcp ? fcp.startTime : null,
    };
  });
}

/**
 * 取一批读数里**稳态段的最小值** —— 本文件的口径本身。
 *
 * 纯函数，好让「弃前 N 轮」这条口径能被单测真跑一次：它是整条判据里唯一会被
 * 「悄悄改成取平均 / 忘了弃斜坡」而不报错的地方。
 *
 * 三种边界都按「判不了」处理（`null`）而不是给一个数字：
 *   · 样本数不足 `discard + 1` ⇒ 稳态段是空的；
 *   · 稳态段里有 `null` ⇒ **不做**「跳过缺失项取 `min`」—— 那会把「读不到」
 *     静默读成「很快」（这正是同一 page 那条路上 `min` 看着特别稳的成因）。
 *
 * @param samples 逐轮读数（按时间顺序）
 * @param discard 弃掉的前几轮
 * @returns 稳态段最小值；判不了时 `null`
 */
export function steadyMin(
  samples: Array<number | null>,
  discard: number = DISCARD_ROUNDS,
): number | null {
  if (samples.length <= discard) {
    return null;
  }
  const kept = samples.slice(discard);
  if (kept.some((v) => v === null || !Number.isFinite(v))) {
    return null;
  }
  return Math.min(.../* SAFETY: 类型断言已复核 */ (kept as Array<number>));
}

/**
 * 跑 `ROUNDS` 轮并收齐读数 —— **每轮一个新 page**（形态的成因见文件头）。
 *
 * 为什么在 `context` 上开 page 而不是 `browser`：同一个 `browserContext` 才带
 * 同一份 cookie / 缓存，贴合「同一个用户重复访问」的形态；换 context 会重新起
 * 一轮冷加载，那是另一件事（本题要判的是稳态，不是冷启动）。
 *
 * `page.close()` 放在 `finally` 之外会漏掉异常路径 —— 所以用 `try` 包住，
 * 出错时也把这一次的 page 收掉（漏掉的表现是后续导航越来越慢，读数静默偏高）。
 *
 * @param context 已就绪的浏览器上下文（**不要**在这里 `newContext()`）
 * @param url 被测路径（相对 `baseURL`）
 * @returns 逐轮的读数（按时间顺序）
 */
export async function collectSamples(
  context: BrowserContext,
  url: string,
): Promise<Array<NavigationSample>> {
  const out: Array<NavigationSample> = [];
  for (let i = 0; i < ROUNDS; i++) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "load" });
      const s = await readNavigationSample(page);
      out.push({
        loadEventEnd: s.loadEventEnd ?? Number.NaN,
        firstContentfulPaint: s.firstContentfulPaint ?? Number.NaN,
      });
    } finally {
      await page.close();
    }
  }
  return out;
}

/**
 * 把一次采集收成判据要用的两个读数（各自带「弃前 N 轮」那一步）。
 *
 * @param samples 逐轮读数
 * @returns `{ loadEventEnd, firstContentfulPaint }`（稳态段 `min`，判不了时 `null`）
 */
export function summarize(samples: Array<NavigationSample>): {
  loadEventEnd: number | null;
  firstContentfulPaint: number | null;
} {
  return {
    loadEventEnd: steadyMin(samples.map((s) => s.loadEventEnd)),
    firstContentfulPaint: steadyMin(samples.map((s) => s.firstContentfulPaint)),
  };
}
