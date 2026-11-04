/**
 * 页面级运行时读数的唯一落点（§11.8 / §13.5.4，ISSUE #1781）：判「下载完之后跑得多快」——bundle 没变而主线程打满时只有这里看得见。
 * 口径：每轮 `newPage()` + `close()`（同一 page 反复 goto 时 FCP 结构性缺失，实测 12/12 补齐），弃前 4 轮取稳态 `min`；只抓主线程 / 浏览器侧。
 * 阈值与实测初值在 `scripts/.runtime-budget-baseline.json`：口径是代码事实、阈值是数字（随例外流程变）。
 */
import type { BrowserContext, Page } from "@playwright/test";

/**
 * 导航轮数：每轮都是真「新开页面 + 导航」，所以它同时是取数总成本。12 / 4 来自立案实测
 * （4 批 × 12 轮）：8 轮稳态足够让 `min` 落定，弃 4 轮是实测斜坡长度（第 5 轮起才稳）。
 * 不写成「越大越准」——每多一轮就是一个新页面 + 一次导航，成本线性。
 */
export const ROUNDS = 12;

/**
 * 弃前几轮 —— 预热斜坡长度（实测）。与 `ROUNDS` 分开：一个是成本、一个是斜坡，
 * 合成一句会在「轮数改了、斜坡没变」时丢掉口径。
 */
export const DISCARD_ROUNDS = 4;

/** 一次导航的读数（毫秒，相对 `navigationStart`）。 */
export type NavigationSample = {
  /** `paint` 时序里 `first-contentful-paint` 的 `startTime`。 */
  firstContentfulPaint: number;
  /** `navigation` 时序的 `loadEventEnd`。 */
  loadEventEnd: number;
};

/**
 * 读**当前这一次导航**的两个时序值：必须每次导航后现读（`performance` 条目按导航重置，
 * 缓存上一轮等于把「第一次导航」当基线用）。拿不到给 `null` 不给默认值 —— `loading` 未完成时
 * `loadEventEnd` 是 0，会被 `min` 当成「最快」静默放行；FCP 缺失同样必须能表达「没有」。
 */
export function readNavigationSample(page: Page): Promise<{
  firstContentfulPaint: number | null;
  loadEventEnd: number | null;
}> {
  return page.evaluate(() => {
    /* SAFETY: 类型断言已复核 */
    const nav = performance.getEntriesByType("navigation")[0] as
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
 * 取一批读数里**稳态段的最小值** —— 本文件的口径本身。纯函数，好让「弃前 N 轮」被单测真跑一次
 * （它是唯一会被悄悄改成取平均 / 忘了弃斜坡而不报错的地方）。判不了时给 `null`：样本不足 `discard + 1`，
 * 或稳态段里有 `null`（**不做**跳过缺失取 `min`，那会把「读不到」读成「很快」）。@param samples 逐轮读数  @param discard 弃前几轮  @returns 最小值或 `null`
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
  /* SAFETY: 类型断言已复核 */
  return Math.min(...(kept as Array<number>));
}

/**
 * 跑 `ROUNDS` 轮并收齐读数 —— **每轮一个新 page**（成因见文件头）；在 `context` 而非 `browser` 上开：同一 `browserContext` 带同一份 cookie / 缓存。
 * 换 context 是冷加载，另一件事。`page.close()` 必须包在 `try` 里：漏掉异常路径的 page 会让后续导航越来越慢、读数静默偏高。
 * @param context 已就绪的上下文（**不要**在这里 `newContext()`） @param url 被测路径（相对 `baseURL`） @returns 逐轮读数（按时间顺序）
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
 * @param samples 逐轮读数  @returns `{ loadEventEnd, firstContentfulPaint }`（稳态段 `min`，判不了时 `null`）
 */
export function summarize(samples: Array<NavigationSample>): {
  firstContentfulPaint: number | null;
  loadEventEnd: number | null;
} {
  return {
    loadEventEnd: steadyMin(samples.map((s) => s.loadEventEnd)),
    firstContentfulPaint: steadyMin(samples.map((s) => s.firstContentfulPaint)),
  };
}
