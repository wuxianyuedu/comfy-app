/**
 * 「页面级运行时性能读数」的取数口径 ⇄ 它的判据（ISSUE #1781 的右半边 / 规范 §11.8）。
 *
 * ## 为什么这条用例必须存在（判据不是空转）
 *
 * `e2e/runtime-budget.spec.ts` 是一条**读数型**断言，它自己没法回答「这个口径是不是
 * 写对了」—— 而口径里恰好有两个**静默失效**的位置，失效时断言**照样绿**：
 *
 *   ① **忘了弃前 N 轮**：实测第 1、2 次导航稳定偏高（预热斜坡）。曾经出现过
 *      第一轮 140ms 这种值 —— 那时「不弃」会把 `min` 读成 140ms，比稳态（320ms）
 *      还小，于是**判据永远绿**、而它自称在守性能。本文件把这条钉成可失败断言。
 *   ② **稳态段有 `null` 时跳过缺失项取 `min`**：那正是立案时那个反直觉读数的成因
 *      ——「同一 page 反复导航时 FCP 结构性缺失，`min` 看着特别稳」。跳过缺失项
 *      等于把「读不到」读成「很快」。
 *
 * 这两条都不是「防手滑」：它们是**实测撞出来的**（现场与读数见
 * `e2e/support/runtime-budget.ts` 的文件头），而失效形态是绿。
 *
 * ## 为什么钉在这里而不是钉在 spec 里
 *
 * `spec.ts` 要起浏览器 + webServer，跑一次是秒级、且只在「全量 e2e」那一档跑
 * （它进不了 C 组的固定清单）。而这条口径是**纯函数**，跑一次是毫秒级 ——
 * 所以把它单拉出来，进固定结构守护清单（`scripts/fixed-structural-tests.mjs`）：
 * **回潮的形态正是「下一次有人动这个口径」**，而那不会把 spec 带进受影响集。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DISCARD_ROUNDS,
  ROUNDS,
  steadyMin,
  summarize,
  type NavigationSample,
} from "../e2e/support/runtime-budget";

/** 造一批读数：前 `DISCARD_ROUNDS` 轮是斜坡（高），其后是稳态。 */
function samplesWith(
  warmup: number,
  steady: number,
  steadyCount = ROUNDS - DISCARD_ROUNDS,
): (number | null)[] {
  return [
    ...Array.from({ length: DISCARD_ROUNDS }, () => warmup),
    ...Array.from({ length: steadyCount }, () => steady),
  ];
}

describe("运行时读数口径（steadyMin / 弃前 N 轮）", () => {
  it("弃掉前 N 轮的斜坡后取 min —— 不弃会把斜坡里的最小值当成稳态", () => {
    /* 实测形态：斜坡**不总是单调下降**（第 1 轮偶尔特别小）。
     * 这正是「不弃」最危险的一种 —— 它给出一个比稳态还小的读数。 */
    const ramp = [140, 480, 460, 450, 320, 325, 330];
    expect(steadyMin(ramp, 4), "弃前 4 轮 ⇒ 稳态 min").toBe(320);
    expect(
      steadyMin(ramp, 0),
      "不弃 ⇒ 140（比稳态还小 ⇒ 判据永远绿）—— 这条断言就是那个失效形态的锚点",
    ).toBe(140);
  });

  it("稳态段就是 min 的含义：取的是最快的一次，不是平均", () => {
    const s = samplesWith(900, 320).map((v, i) =>
      // 稳态段末尾插一个大值，证明它不影响 min
      i === ROUNDS - 1 ? 9999 : v,
    );
    expect(steadyMin(s)).toBe(320);
  });

  it("样本数不足（稳态段为空）⇒ 判不了，返回 null", () => {
    expect(steadyMin([900, 900], DISCARD_ROUNDS)).toBeNull();
    expect(steadyMin([900, 900], 4), "恰好等于弃的轮数也是空").toBeNull();
    expect(steadyMin([900, 900, 900, 900, 320], 4), "多一轮就判得了").toBe(320);
  });

  it("稳态段含 null（读不到）⇒ null，**不许**跳过缺失项取 min", () => {
    /* 这就是「同一 page 反复导航」那条路上发生的事（FCP 结构性缺失）。 */
    const withHole = [900, 900, 900, 900, 320, null, 330];
    expect(
      steadyMin(withHole, 4),
      "跳过 null 取 min 会把「读不到」读成「很快」（实测形态）",
    ).toBeNull();
    /* ⚠️ 斜坡段里的 null **不**影响结论：那几轮本来就要弃掉。 */
    expect(steadyMin([null, null, null, null, 320, 330], 4)).toBe(320);
  });

  it("NaN（页面没给出读数）同样按「判不了」处理，不是按 0", () => {
    expect(steadyMin([900, 900, 900, 900, Number.NaN, 330], 4)).toBeNull();
  });

  it("summarize 两档各自弃前 N 轮，且形状与 spec 读的两栏一致", () => {
    const samples: NavigationSample[] = Array.from(
      { length: ROUNDS },
      (_, i) => ({
        // 斜坡段故意让 load 也不单调
        loadEventEnd: i < DISCARD_ROUNDS ? 900 : 320,
        firstContentfulPaint: i < DISCARD_ROUNDS ? 700 : 250,
      }),
    );
    expect(summarize(samples)).toEqual({
      loadEventEnd: 320,
      firstContentfulPaint: 250,
    });
  });

  it("口径的形状常量：ROUNDS > DISCARD_ROUNDS，且稳态段不止一两轮", () => {
    /* 不写死 12/4（那两个数会随实测变）—— 判的是**关系**：
     * 弃的轮数必须严格小于总轮数（否则稳态段恒空、判据恒 null ⇒ 恒「读不到」），
     * 且至少留 4 轮稳态（1~2 轮的 min 没有抗噪能力）。 */
    expect(DISCARD_ROUNDS).toBeLessThan(ROUNDS);
    expect(ROUNDS - DISCARD_ROUNDS).toBeGreaterThanOrEqual(4);
  });
});

/**
 * 基线文件 ⇄ spec 里的阈值：**两处各写一份就会漂，而漂了不会红**。
 *
 * 这正是 `check-bundle-budget` 落地时踩过的形态（数字住在基线文件里、判据读它）；
 * 而这一条与它**刻意不同**的一处是：spec 跑在 Playwright 里、**不在 vitest 的模块图
 * 上**，所以它读不到这个文件（e2e 侧没有 `node:fs` 的正当用法 —— 那份 spec 要在
 * 浏览器里跑）。于是「基线 ⇄ spec 常量」之间那条缝必须有判据：否则 `--update`
 * 只改基线文件、spec 里的数字还是旧的，而两边都不报错。
 *
 * 判据只核**数字同源**（读基线 JSON + 读 spec 源码里的常量），不核阈值该是多少 ——
 * 那是实测的事。
 */
describe("运行时预算基线文件 ⇄ spec 常量同源", () => {
  const REPO_ROOT = process.cwd();
  const baseline = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "scripts/.runtime-budget-baseline.json"),
      "utf8",
    ),
  ) as {
    metric: {
      loadEventEnd?: number;
      firstContentfulPaint?: number;
      factor: number;
      rounds: number;
      discard: number;
      byPlatform?: Record<
        string,
        { loadEventEnd: number; firstContentfulPaint: number }
      >;
    };
  };
  const spec = readFileSync(
    join(REPO_ROOT, "e2e/runtime-budget.spec.ts"),
    "utf8",
  );

  it("两个平台的基线与 spec 里写的逐字一致", () => {
    /* 按平台各自一份（2026-10-13，ISSUE #1834 收尾的 win32 读数）：两平台的
     * 稳态读数差 2.2×，共用一个数会让另一种宿主恒红或不设防。逐字同源这条
     * 判据因此要覆盖**两个平台**——只核一个等于放任另一个漂。 */
    const byPlatform = baseline.metric.byPlatform;
    expect(byPlatform, "基线里要有 byPlatform（按平台各自校准）").toBeDefined();
    for (const platform of ["posix", "win32"] as const) {
      const inBaseline = byPlatform?.[platform];
      expect(inBaseline, `基线里缺 ${platform} 档`).toBeDefined();
      for (const [label, re] of [
        ["loadEventEnd", new RegExp(`${platform}: \\{ loadEventEnd: (\\d+)`)],
        [
          "firstContentfulPaint",
          new RegExp(`loadEventEnd: ${inBaseline?.loadEventEnd}, firstContentfulPaint: (\\d+)`),
        ],
      ] as const) {
        const inSpec = Number(re.exec(spec)?.[1]);
        expect(
          inSpec,
          `spec 里 ${platform} 的 ${label}=${inSpec} 与基线文件的 ${inBaseline?.[label]} 不一致 —— ` +
            `改了一处没改另一处（两边都不会报错，读到的预算就与实测基线脱钩了）`,
        ).toBe(inBaseline?.[label]);
      }
    }
  });

  it("倍数两平台同一个数（spec 里只写一份）", () => {
    /* 倍数不按平台分档：相对灵敏度不该因宿主打折（各自的基线已经吃掉了机器差）。 */
    const inSpec = Number(/factor: (\d+)/.exec(spec)?.[1]);
    expect(inSpec).toBe(baseline.metric.factor);
  });

  it("基线里的轮数与取数口径的常量一致（口径改了要同批改基线）", () => {
    expect(baseline.metric.rounds).toBe(ROUNDS);
    expect(baseline.metric.discard).toBe(DISCARD_ROUNDS);
  });

  it("两个平台的读数与倍数都是正数（JSON 里被写成 0 会让判据恒绿）", () => {
    for (const platform of ["posix", "win32"] as const) {
      const m = baseline.metric.byPlatform?.[platform];
      expect(m, `基线里缺 ${platform} 档`).toBeDefined();
      expect(m?.loadEventEnd).toBeGreaterThan(0);
      expect(m?.firstContentfulPaint).toBeGreaterThan(0);
    }
    expect(baseline.metric.factor).toBeGreaterThanOrEqual(1);
  });
});

/**
 * 现场编译档的并发（ISSUE #1834）—— **它改的是负载，不是任何判据的预算**。
 *
 * 立案现场：`node scripts/e2e-run.mjs` 在 win32 检出上报 43 failed / 35 passed，
 * 其中 33 条正好卡在 `Test timeout of 60000ms exceeded (1.0m)`，散在互不相干的屏上
 * —— dev server 按需编译 + 8 worker 并发时，首帧导航吃满自测向预算。
 *
 * 这一档的取向是**降并发**而不是抬 `timeout`（`timeout` 是判据本身，抬它等于拿预算
 * 换绿，会把真挂死的检出时间一起放大 —— §11.13 那句「看到 60s 都超时不要改成 120s」）。
 * 所以这条用例要钉住的是：**判据一个字没动，动的只有负载**。
 */
describe("e2e 的并发档：现场编译 ⟺ 已构建（ISSUE #1834）", () => {
  const configSrc = readFileSync(
    join(process.cwd(), "playwright.config.ts"),
    "utf8",
  );

  it("现场编译（未给 PNPM_START / 非 CI）⇒ 收敛到 COLD_COMPILE_WORKERS", async () => {
    const { resolveE2eWorkers } = await import("../playwright.config");
    // 不是本仓默认的 8（`vitest.config.ts` 那一档），也不是「不设」—— 是那个显式的档。
    // 2 是 #1834 的 win32 实测档：4 仍有 3 条 goto 卡 60s，单 worker 独跑同屏 14.8s。
    expect(resolveE2eWorkers({} as unknown as NodeJS.ProcessEnv)).toBe(2);
  });

  it("已构建（CI 或 PNPM_START）⇒ 不覆盖 Playwright 的默认并行", async () => {
    const { resolveE2eWorkers } = await import("../playwright.config");
    /* `undefined` 是「不写 `workers` 这个键」——工厂函数不许在这里发明一个数：
     * 生产构建下首屏零编译，并发不是这一格的自由度。 */
    expect(
      resolveE2eWorkers({ CI: "1" } as unknown as NodeJS.ProcessEnv),
    ).toBeUndefined();
    expect(
      resolveE2eWorkers({ PNPM_START: "1" } as unknown as NodeJS.ProcessEnv),
    ).toBeUndefined();
  });

  it("两档判的是同一对键：`scripts/e2e-run.mjs` 的读数与配置不分叉", async () => {
    /* 跑法脚本要在输出里说清「这一趟是哪一档」（否则 8.7 分钟 / 43 failed 这个读数
     * 读不出是哪种负载），所以它自己也算一遍 —— 两处各写一份就有漂的可能，这条用例
     * 把它们钉在一起。两边**刻意不互相 import**：`playwright.config.ts` 是 Playwright
     * 的入口文件，拿它当纯函数库引进来会让跑法脚本依赖整个配置图的求值。 */
    const { resolveServerMode } = (await import("../scripts/e2e-run.mjs")) as {
      resolveServerMode: (env: NodeJS.ProcessEnv) => {
        start: boolean;
        workers: number | null;
      };
    };
    for (const env of [{}, { CI: "1" }, { PNPM_START: "1" }]) {
      const viaConfig = (
        await import("../playwright.config")
      ).resolveE2eWorkers(env as unknown as NodeJS.ProcessEnv);
      const viaRunner = resolveServerMode(env as unknown as NodeJS.ProcessEnv);
      expect(
        viaRunner.start,
        "`start` 档与配置里 webServer 那条命令读的是同一对键",
      ).toBe(viaConfig === undefined);
      expect(viaRunner.workers).toBe(viaConfig ?? null);
    }
  });

  it("`timeout` 一个字节都没动 —— 降的是负载，不是预算", () => {
    /* 这条是整档的**红线**：如果有人把 `timeout: 60_000` 改成 120_000 来「修」这条红，
     * 那正是 §11.13 要拦的形态，而它在别处不会红。 */
    /* 认的是**顶层那个自测向预算**（`use` 之前那一条），不是写死的 `180_000` /
     * 那两条 webServer 等待窗口 —— 它们各有各的量级，不是这条红线管的东西。 */
    const topLevelTimeouts = [
      ...configSrc.matchAll(/^ {2}timeout: ([\d_]+),$/gm),
    ].map((m) => m[1]);
    expect(topLevelTimeouts).toEqual(["60_000"]);
  });
});
