/** 「页面级运行时性能读数」的取数口径 ⇄ 判据（ISSUE #1781 的右半边 / 规范 §11.8）。口径里有两个
 * **静默失效**的位置，失效时断言照样绿：①忘了弃前 N 轮 —— 实测前两次导航偏高（首轮曾读到 140ms，
 * 比稳态 320ms 还小 ⇒ 判据永远绿）；②稳态段有 `null` 时跳过缺失项取 `min` —— 立案时的反直觉读数
 * （「反复导航 FCP 结构性缺失，min 看着特别稳」），等于把「读不到」读成「很快」。
 * 钉在这里而非 spec 里：口径是纯函数（毫秒级），进固定清单，而回潮形态正是有人动这个口径（不会带进 spec）。 */
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
): Array<number | null> {
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
    const samples: Array<NavigationSample> = Array.from({ length: ROUNDS }, (_, i) => ({
      // 斜坡段故意让 load 也不单调
      loadEventEnd: i < DISCARD_ROUNDS ? 900 : 320,
      firstContentfulPaint: i < DISCARD_ROUNDS ? 700 : 250,
    }));
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
 * 基线文件 ⇄ spec 里的阈值：**两处各写一份就会漂，而漂了不会红**（`check-bundle-budget` 落地时踩过）。
 * spec 跑在 Playwright 里、不在 vitest 的模块图上，读不到这个文件（e2e 侧没有 `node:fs` 的正当用法），
 * 所以「基线 ⇄ spec 常量」的缝必须有判据（否则 `--update` 只改基线、两边都不报错）；只核数字同源。
 */
describe("运行时预算基线文件 ⇄ spec 常量同源", () => {
  const REPO_ROOT = process.cwd();
  /* SAFETY: 类型断言已复核 */
  const baseline = JSON.parse(
    readFileSync(join(REPO_ROOT, "scripts/.runtime-budget-baseline.json"), "utf8"),
  ) as {
    metric: {
      byPlatform?: Record<string, { firstContentfulPaint: number; loadEventEnd: number }>;
      discard: number;
      factor: number;
      firstContentfulPaint?: number;
      loadEventEnd?: number;
      rounds: number;
    };
  };
  const spec = readFileSync(join(REPO_ROOT, "e2e/runtime-budget.spec.ts"), "utf8");

  it("两个平台的基线与 spec 里写的逐字一致", () => {
    /* 按平台各自一份（2026-10-13，ISSUE #1834 收尾的 win32 读数）：两平台的
     * 稳态读数差 2.2×，共用一个数会让另一种宿主恒红或不设防。逐字同源这条
     * 判据因此要覆盖**两个平台**——只核一个等于放任另一个漂。 */
    const byPlatform = baseline.metric.byPlatform;
    expect(byPlatform, "基线里要有 byPlatform（按平台各自校准）").toBeDefined();
    /* SAFETY: 类型断言已复核 */
    for (const platform of ["posix", "win32"] as const) {
      const inBaseline = byPlatform?.[platform];
      expect(inBaseline, `基线里缺 ${platform} 档`).toBeDefined();
      /* SAFETY: 类型断言已复核 */
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
    const inSpec = Number(/factor: (?<factor>\d+)/.exec(spec)?.groups?.factor);
    expect(inSpec).toBe(baseline.metric.factor);
  });

  it("基线里的轮数与取数口径的常量一致（口径改了要同批改基线）", () => {
    expect(baseline.metric.rounds).toBe(ROUNDS);
    expect(baseline.metric.discard).toBe(DISCARD_ROUNDS);
  });

  it("两个平台的读数与倍数都是正数（JSON 里被写成 0 会让判据恒绿）", () => {
    /* SAFETY: 类型断言已复核 */
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
 * 现场编译档的并发（ISSUE #1834）—— **它改的是负载，不是任何判据的预算**。立案现场：
 * `node scripts/e2e-run.mjs` 在 win32 检出报 43 failed / 35 passed，33 条卡在 `Test timeout of
 * 60000ms`（dev 按需编译 + 8 worker，首帧导航吃满自测向预算）。取向是**降并发**而不是抬 `timeout`
 * （抬预算 = 拿预算换绿，§11.13），所以钉住的是：判据一个字没动，动的只有负载。 */
describe("e2e 的并发档：两档都收敛，且按现场核数（ISSUE #1834 / #1998）", () => {
  const configSrc = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");

  /* 这两条断言语义是「核够 ⇒ 收敛到 COLD_COMPILE_WORKERS」，故核数必须显式注入（`CNB_CPUS`，与
   * 「核数是事实」那条同一个旋钮）：被判函数的契约是 `min(2, cpus-1)`，2 核宿主机按设计算出 1
   * （GitHub 镜像仓的 ubuntu-24.04 runner 正是 2 核，不是仓库能修的环境）。注入不改判据强度：
   * `toBe(2)` 一个字没动，小机器那档仍由下面那条钉 `toBe(1)`。 */
  it("现场编译（未给 PNPM_START / 非 CI）⇒ 收敛到 COLD_COMPILE_WORKERS", async () => {
    const { resolveE2eWorkers } = await import("../playwright.config");
    // 不是本仓默认的 8（`vitest.config.ts` 那一档），也不是「不设」—— 是那个显式的档。
    // 2 是 #1834 的 win32 实测档：4 仍有 3 条 goto 卡 60s，单 worker 独跑同屏 14.8s。
    /* SAFETY: 类型断言已复核 */
    expect(resolveE2eWorkers({ CNB_CPUS: "16" } as unknown as NodeJS.ProcessEnv)).toBe(2);
  });

  it("已构建（CI 或 PNPM_START）⇒ 同样收敛（#1998：15 worker 跑成 36 分钟）", async () => {
    const { resolveE2eWorkers } = await import("../playwright.config");
    /* 这一格在 #1834 时是 `undefined`（「生产构建下并发不是自由度」），而实测把那条
     * 理由推翻了一半：并发不是**编译**的问题，是「这台机同时开几个浏览器 + 几个
     * worker」的问题。`cnb-m0t-1k54oljem`（PR #1998）：生产构建那一档没写这个键 ⇒
     * Playwright 按 `cpus - 1` 铺开 15 个 ⇒ `E2E 关键流程` 跑到 36 分钟被墙钟 kill。 */
    expect(
      /* SAFETY: 类型断言已复核 */
      resolveE2eWorkers({ CI: "1", CNB_CPUS: "16" } as unknown as NodeJS.ProcessEnv),
    ).toBe(2);
    expect(
      /* SAFETY: 类型断言已复核 */
      resolveE2eWorkers({ PNPM_START: "1", CNB_CPUS: "16" } as unknown as NodeJS.ProcessEnv),
    ).toBe(2);
  });

  it("核数是事实：小机器上不开 2（`CNB_CPUS` 优先，读不到落本机）", async () => {
    const { resolveE2eWorkers, resolveLocalCpus } = await import("../playwright.config");
    /* SAFETY: 类型断言已复核 */
    const env = (cnbCpus: string) => ({ CNB_CPUS: cnbCpus }) as unknown as NodeJS.ProcessEnv;
    expect(resolveE2eWorkers(env("2"))).toBe(1); // cpus - 1 = 1
    expect(resolveE2eWorkers(env("1"))).toBe(1); // 单核不收敛成 0
    expect(resolveE2eWorkers(env("16"))).toBe(2); // 16 核算出 15，取上界 2
    /* 不合法值**不静默变成 0**（那会让 `min(2, cpus-1)` 退化成 1，看着像「小机器」）：
     * 往后落到本机读数，两条都拿不到才回 0（= 只用上界）。 */
    expect(resolveLocalCpus(env("abc"))).toBeGreaterThanOrEqual(1);
    expect(resolveE2eWorkers(env("abc"))).toBeGreaterThanOrEqual(1);
    expect(
      /* SAFETY: 类型断言已复核 */
      resolveE2eWorkers({} as unknown as NodeJS.ProcessEnv, 0),
    ).toBe(2);
  });

  it("跑法脚本的读数与配置不再分叉：两档都说清并发", async () => {
    /* 跑法脚本要在输出里说清「这一趟是哪一档、开几个并发」（否则 36 分钟这个读数
     * 读不出是哪种负载）—— 两边**刻意不互相 import**（`playwright.config.ts` 是
     * Playwright 的入口文件，拿它当纯函数库引进来会让跑法脚本依赖整个配置图的求值），
     * 所以这一条钉的是「同一个 webServer 档 + 两侧都报得出 worker 数」。 */
    /* SAFETY: 类型断言已复核 */
    const { resolveServerMode } = (await import("../scripts/e2e-run.mjs")) as {
      resolveServerMode: (env: NodeJS.ProcessEnv) => {
        start: boolean;
        workers: number | null;
      };
    };
    /* SAFETY: 类型断言已复核 */
    const local = resolveServerMode({} as unknown as NodeJS.ProcessEnv);
    expect(local.start).toBe(false);
    expect(local.workers).toBe(2);
    for (const env of [{ CI: "1" }, { PNPM_START: "1" }]) {
      /* SAFETY: 类型断言已复核 */
      const viaRunner = resolveServerMode(env as unknown as NodeJS.ProcessEnv);
      expect(viaRunner.start, "生产构建那一档").toBe(true);
      // `null` = 「Playwright 默认」—— 而 `CI` 档的默认正是本条要治的那一格。
      expect(
        viaRunner.workers,
        "生产构建那一档也必须说得出并发（它此前是 `Playwright 默认` = 15）",
      ).not.toBeNull();
    }
  });

  it("`COMFY_E2E_SERVER` 显式优先，且两份实现给同一个答案（认不出的值必须抛）", async () => {
    /* 立案（`cnb-ob4-1k5828a36`）：PR 撤掉 `生产构建` 后，`E2E 关键流程` 仍以 `CI ⇒ pnpm start` 起一台
     * **没有产物**的生产服务器 ⇒ `Could not find a production build` + `Timed out waiting 180000ms`。
     * 那句话把「是不是 CI」与「有没有产物」绑成一件，所以现由 stage 显式声明（`每日全量E2E` 写 `start`）。
     * 三份判据各有失效形态：①两份实现同答案（否则日志说 dev、跑的其实是 start，比没有更坏，§11.23）；
     * ②显式压过 `CI`；③认不出的值抛而不是回落（回落 = 拼错字母悄悄换档，两档负载形态完全不同）。 */
    const { resolveWebServerCommand, E2E_SERVER_COMMANDS } = await import("../playwright.config");
    /* SAFETY: 类型断言已复核 */
    const { resolveServerMode } = (await import("../scripts/e2e-run.mjs")) as {
      resolveServerMode: (env: NodeJS.ProcessEnv) => { start: boolean };
    };
    /* ② + ①：四组环境，两份实现逐组对账。 */
    /* SAFETY: 类型断言已复核 */
    for (const env of [
      { COMFY_E2E_SERVER: "dev" },
      { COMFY_E2E_SERVER: "start" },
      { COMFY_E2E_SERVER: "dev", CI: "1", PNPM_START: "1" },
      { CI: "1" },
      { PNPM_START: "1" },
      {},
    ] as Array<Record<string, string>>) {
      /* SAFETY: 类型断言已复核 */
      const command = resolveWebServerCommand(env as unknown as NodeJS.ProcessEnv);
      /* SAFETY: 类型断言已复核 */
      const mode = resolveServerMode(env as NodeJS.ProcessEnv);
      expect(command, JSON.stringify(env)).toBe(
        mode.start ? E2E_SERVER_COMMANDS.start : E2E_SERVER_COMMANDS.dev,
      );
    }
    /* 显式 `dev` 压过 `CI`：这正是「PR 那条没有产物」那一档的形状。 */
    expect(
      /* SAFETY: 类型断言已复核 */
      resolveWebServerCommand({
        COMFY_E2E_SERVER: "dev",
        CI: "1",
      } as unknown as NodeJS.ProcessEnv),
      "显式的 dev 没压过 CI —— 那这个旋钮等于没有，`CI ⇒ start` 那句旧推论还在管事",
    ).toBe("pnpm dev");
    /* ③：认不出的值两份都抛。 */
    /* 只认 `dev` / `start`（大小写不敏感：值是从 YAML 的 env 里来的，`Start` 认是**刻意的**，
     * 拼错单词才抛）。 */
    for (const bad of ["deev", "production", "star"]) {
      expect(
        () =>
          /* SAFETY: 类型断言已复核 */
          resolveWebServerCommand({
            COMFY_E2E_SERVER: bad,
          } as unknown as NodeJS.ProcessEnv),
        `配置那一份对 "${bad}" 回落了`,
      ).toThrow(/COMFY_E2E_SERVER/);
      expect(
        () =>
          /* SAFETY: 类型断言已复核 */
          resolveServerMode({
            COMFY_E2E_SERVER: bad,
          } as unknown as NodeJS.ProcessEnv),
        `跑法那一份对 "${bad}" 回落了`,
      ).toThrow(/COMFY_E2E_SERVER/);
    }
    /* 空串**不算**一个显式值：它落回旧规则。这一格管的是「两份实现对同一个输入的
     * 答案是不是同一句」—— 任一处把空串当成显式值去抛，配置那一份与跑法那一份就会
     * 一个抛、一个放行，而红出现在谁身上都不像配置问题。 */
    expect(
      /* SAFETY: 类型断言已复核 */
      resolveWebServerCommand({
        COMFY_E2E_SERVER: "",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("pnpm dev");
  });

  it("`timeout` 一个字节都没动 —— 降的是负载，不是预算", () => {
    /* 这条是整档的**红线**：如果有人把 `timeout: 60_000` 改成 120_000 来「修」这条红，
     * 那正是 §11.13 要拦的形态，而它在别处不会红。 */
    /* 认的是**顶层那个自测向预算**（`use` 之前那一条），不是写死的 `180_000` /
     * 那两条 webServer 等待窗口 —— 它们各有各的量级，不是这条红线管的东西。 */
    const topLevelTimeouts = [...configSrc.matchAll(/^ {2}timeout: (?<timeout>[\d_]+),$/gm)].map(
      (m) => m.groups?.timeout,
    );
    expect(topLevelTimeouts).toEqual(["60_000"]);
  });
});
