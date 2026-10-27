/**
 * 提交门槛 C 组的**启动那一步**的判据。
 *
 * ## 事故形状（这条判据不是预防性的，是补的）
 *
 * C 组原本是 `pnpm exec vitest run --maxWorkers=4 $files`。清单是位置参数，长度随
 * 改动面线性增长；而 `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim，那条链的命令行
 * 上限是 cmd.exe 的 **8191 字符**。一次改了 22 个文件的提交，清单实测 10840 字符
 * —— vitest 根本没启动，stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），
 * 钩子的表现是「组 C 失败」而看不见任何用例名。
 *
 * 危害不在「提交被拦」，而在**它长得像任何别的东西**：判据在场、跑的是 0 个用例、
 * 退出码非零但原因读不出。改动面越大的批次越容易撞上，也就是治理线自己的批次
 * 最先撞 —— 这与本仓库反复在收的那一族同源：「绿 ≠ 跑过」的反面形态「红 ≠ 跑过」。
 *
 * ## 判的四件事
 *
 * 1. 分块**不丢不重**（并集等于输入且顺序保持）—— 丢用例的形态就是「绿但没跑」；
 * 2. 每一块都在命令行长预算之内，且单个路径超预算时**点名红**而不是静默跳过；
 * 3. 启动器不经 shell 层（`spawnSync(process.execPath, …)`，没有 `shell: true`），
 *    钩子也不再直接拼 `pnpm exec vitest run $files`；
 * 4. 空清单必须被阻断，绝不让 `vitest run` 不带位置参数跑成全量。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { wideFallbackNote } from "../scripts/affected-tests.mjs";
/* 「认出超时形态 + 等机器喘口气」那一层住在自己的模块里（`run-affected-tests.mjs`
 * 越过 900 行硬闸时按职责拆出，理由写在那份文件头）。用例跟着 import 走，不在这里
 * 再要一份 `run-affected-tests.mjs` 的同名出口 —— 那等于给拆出去的块留一条「搬走了
 * 但还能从老地方拿到」的假象。 */
import {
  isLaunchFailureShaped,
  isTimeoutShaped,
  loadPerCore,
  remainingWaitMs,
  waitForLoadToSettle,
} from "../scripts/affected-launch-load-retry.mjs";
import {
  planLaunches,
  resolveMaxWorkers,
  resolveVitestEntry,
  runChunk,
  SAFE_ARGV_BUDGET,
} from "../scripts/run-affected-tests.mjs";
/* 「这一跑用哪个 reporter」住在自己那份文件里（日志预算那一刀）。用例跟着 import 走，
 * 不从启动器那儿再要一份同名出口 —— 那等于给搬出去的块留一条「搬走了但还能从老地方
 * 拿到」的假象（与上面 `affected-launch-load-retry.mjs` 同一条处置）。 */
import {
  announceQuiet,
  reporterArgs,
  resolveQuiet,
} from "../scripts/affected-launch-log-budget.mjs";
/* 墙钟判点（ISSUE #2364）：等待有预算而**跑**没有上界，于是负载膨胀时那一格一路开到被
 * 平台掐掉（实测 3240105ms），连「未判定」那句话都没说出来。下面这几条钉两件事：
 * **界只划在「还开不开下一遍」**（已开跑的那一遍永远跑完），以及**「没开」不许长得像
 * 「测过了」**。 */
import {
  affordablePerFileCount,
  budgetAllows,
  estimateSerialRerunMs,
  perFileBudgetStopReport,
  PLATFORM_STAGE_KILL_MS,
  resolveWallClockMs,
  SERIAL_RERUN_FACTOR,
  STAGE_WALL_CLOCK_MS,
  wallClockBudget,
  wallClockSkipReport,
} from "../scripts/affected-launch-wallclock.mjs";
/* junit 取数/落盘形状层拆到自己那份之后（ISSUE #2364 撞上 900 行硬闸那一刀），这里按
 * 真实落点 import —— 判据跟着搬走的符号一起改路径，而不是让机制层转出假出口。
 * 「日志预算那一刀」把同名两件事另抽过一份，已并进这份（两侧各抄一份文件名会静默漂开）。 */
import {
  junitReportArgs,
  writeFilesManifest,
} from "../scripts/affected-launch-junit-io.mjs";
/* 分文件读数的**两侧**要判的是同一个布局，所以判据同时 import 读的那一侧：只测写的
 * 一侧（"它传了某个文件名"）挡不住读的一侧改了前缀 —— 而那正会退化成「永远读不到，
 * 且看起来像这次没有读数」。 */
import {
  cFileXmlName,
  collectFileTimings,
  failingSuiteTextsFromJunit,
} from "../scripts/precommit-timing.mjs";
/* 复跑面那一层同理：按它真实的落点 import（机制层拆出去之后不再转一层假出口）。 */
import { retryScope } from "../scripts/affected-launch-retry-scope.mjs";
/* 判决粒度那一层（第 2 遍的红按文件分开）—— #2225 之后它不再住在 runChunk 的那一句
 * `isTimeoutShaped(整块输出)` 里，所以它的三档结论要能被单独钉住。 */
import {
  classifyRetry,
  mergePerFileReads,
} from "../scripts/affected-launch-retry-verdict.mjs";
/* 话术层（收尾那两份账）现在住在自己那份文件里 —— 这里按它真实的落点 import，
 * 而不是让机制层再转出一层「看起来还在那儿」的假出口。 */
import {
  rerunReport,
  unverifiedReport,
} from "../scripts/affected-launch-rerun-report.mjs";
import { groupShBody, withoutCommentLines } from "./helpers/hook-groups";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_PATH = ".githooks/pre-commit";
const LAUNCHER_PATH = "scripts/run-affected-tests.mjs";

/**
 * 把一段代码跑起来期间 `process.stderr` 的写入**收在手里**（随返回值交出 `text`）。
 *
 * 为什么要有这个：`runChunk` 的每一档判决都会往 stderr 写话术（「第 2 遍全绿」、
 * 「记为未校验」、「按真红处置」…），而下面这些用例绝大多数只关心**退出码**。不抓的话
 * 每跑一次就在 vitest 的报告里糊一段夹具的判决话术，与本文件无关的人读报告时会以为
 * 那是**真跑**出来的结论 —— 实测踩到过两次：
 *
 *   · 本机：那几段被误读成 C 组自己的输出；
 *   · 平台：`cnb-n1j-1k5ct202i` 第 9 格（受影响用例）的日志里，这一族话术与真跑的
 *     输出逐字同形，读日志的人按「负载假红 / 真红」去查产品代码，而那一次 32 格全绿。
 *
 * 所以**每一处**调用 `runChunk` 的用例都必须走它（或走下面那份委托它的 `runCapturing`），
 * 「不许有漏掉的调用点」由本文件末尾那条判据钉住（针尖的构造方式见它里面的说明）。
 */
async function captureStderr<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; text: string }> {
  const chunks: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s: string | Uint8Array) => {
    chunks.push(String(s));
    return true;
  };
  try {
    return { value: await fn(), text: chunks.join("") };
  } finally {
    process.stderr.write = realWrite;
  }
}

/** 造一份「n 个用例」的合成清单，单条长度接近真实值（约 60 字符）。 */
function syntheticFiles(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) =>
      `src/components/studio/feature-${Math.floor(i / 100)}/hooks/use-thing-${i}.test.ts`,
  );
}

/**
 * C 组的**实调用体**：`run_group C "…" sh -c '<body>'` 里那段 shell，剔掉行首是 `#` 的行。
 *
 * 为什么解析而不是 `hook.toContain("scripts/run-affected-tests.mjs")`：本文件上方那段
 * 机制说明里就写着这个文件名，`toContain` 会**在注释上命中** —— 有人把那一行注掉，
 * 判据照样绿。同一条教训由刚落地的 `tests/doc-check-hook-wiring.test.ts` 给出
 * （「在场判据要解析、不要 toContain」，规范 §13.5.8）。
 */
function cGroupBody(hookText: string): string {
  // 解析器本体在 `tests/helpers/hook-groups.ts`（与本目录下另外两处消费者共用一份；
  // 各写一份就会漂成「同一份钩子在三条判据里长成三个形状」，§12.12 / §12.18）。
  return withoutCommentLines(groupShBody(hookText, "C"));
}

describe("受影响用例的启动器", () => {
  it("分块不丢不重，且顺序与输入一致", () => {
    const files = syntheticFiles(400);
    /* 用一个**故意小**的预算来逼出多块：判据要的是「分块策略不丢用例」这条性质，
     * 而不是「400 条恰好会超真实的 24000」那种会随模板长度腐烂的算术。 */
    const chunks = planLaunches(files, 4_000);
    const flattened = chunks.flat();
    expect(flattened).toEqual(files);
    expect(flattened).toHaveLength(files.length);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.join(" ").length).toBeLessThanOrEqual(4_000);
    }
  });

  it("每一块的命令行都不超预算（预算放大到真实值也一样）", () => {
    const files = syntheticFiles(1200);
    for (const chunk of planLaunches(files, SAFE_ARGV_BUDGET)) {
      expect(chunk.join(" ").length).toBeLessThanOrEqual(SAFE_ARGV_BUDGET);
    }
    expect(planLaunches(files, SAFE_ARGV_BUDGET).flat()).toHaveLength(1200);
  });

  it("实测那份清单的长度在预算内 —— 只起一次（钩子把三次冷启合成一次的那笔账不能倒退）", () => {
    /* 真实值：一次改 22 个文件的提交算出 229 个用例 / 10840 字符，正是它顶穿了
     * cmd.exe 的 8191 却仍在 node 直起的预算内。按同样的规模合成一份，必须是一整块。 */
    const files = syntheticFiles(229);
    const joined = files.join(" ");
    expect(joined.length).toBeGreaterThan(8_191);
    expect(joined.length).toBeLessThanOrEqual(SAFE_ARGV_BUDGET);
    expect(planLaunches(files, SAFE_ARGV_BUDGET)).toHaveLength(1);
  });

  it("单条路径就超预算时点名红，不静默丢掉它", () => {
    const tooLong = ["src/" + "a".repeat(SAFE_ARGV_BUDGET) + ".test.ts"];
    expect(() => planLaunches(tooLong, SAFE_ARGV_BUDGET)).toThrow(
      /单个路径就超过命令行长预算/,
    );
  });

  it("空清单不产出任何一块 —— 阻断由调用方负责（否则 vitest 会跑成全量）", () => {
    expect(planLaunches([])).toEqual([]);
  });

  it("vitest 的 ESM 入口在本机解析得到（写死 node_modules 路径会指到空气上）", () => {
    const entry = resolveVitestEntry();
    expect(entry.endsWith("vitest.mjs")).toBe(true);
    // pnpm 布局下真身在 `.pnpm/vitest@<ver>…/node_modules/vitest/`，顶层是链接。
    expect(entry.replace(/\\/g, "/")).toContain("/vitest/");
  });

  it("启动器不经 shell 层：spawn 的是 node 自己，且没有 shell:true", () => {
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toContain("spawnSync(");
    expect(src).toContain("process.execPath");
    expect(src).not.toMatch(/shell:\s*true/);
    // 反向：不许退回「把清单交给 pnpm/exec 的 cmd shim」那一条链。
    expect(src).not.toMatch(/pnpm\s+exec\s+vitest/);
    expect(src).not.toMatch(/npx\s+vitest/);
  });

  it("钩子的 C 组走这个入口，且不再把清单直接拼成 `pnpm exec vitest run $files`", () => {
    const hook = readFileSync(HOOK_PATH, "utf8");
    // 扫描面非空：C 组整块被改名时「零命中」会长得像「都接好了」。
    expect(hook).toContain("run_group C");
    const body = cGroupBody(hook);
    expect(body).not.toBe("");
    expect(body).toMatch(/node\s+scripts\/run-affected-tests\.mjs/);
    expect(body).not.toMatch(/pnpm\s+exec\s+vitest/);
    expect(body).not.toMatch(/\$files/);
  });

  it("反向证明：注掉那一行、或退回旧拼法，都必须被照出来", () => {
    /* 这一条专防「判据在注释上命中」：本文件上方的机制说明里也写着那个文件名，
     * 只看整份文本的 toContain 分不出「在执行」与「已被静音」。教训来自落地的
     * `tests/doc-check-hook-wiring.test.ts`（规范 §13.5.8「在场判据要解析」）。 */
    const muted = [
      'run_group C "结构守护测试" sh -c \'',
      "  # node scripts/run-affected-tests.mjs",
      "'",
    ].join("\n");
    expect(cGroupBody(muted)).toBe("");

    const oldShape = [
      'run_group C "结构守护测试" sh -c \'',
      "  files=$(node scripts/affected-tests.mjs) || exit 1",
      "  pnpm exec vitest run --maxWorkers=4 $files'",
    ].join("\n");
    const oldBody = cGroupBody(oldShape);
    expect(oldBody).toMatch(/pnpm\s+exec\s+vitest/);
    expect(oldBody).not.toMatch(/node\s+scripts\/run-affected-tests\.mjs/);
  });
});

/**
 * C 组的**负载自适应**：超时形态的失败要自动隔离复跑，不再把提交拦在这里。
 *
 * ## 现场（实测，8 核容器 / 本轮复现）
 *
 * 同一份代码、同一个提交：空闲时这 67 个用例 21s 全绿（685/685）；把机器压到
 * load≈77 时 `tests/ratchet-update-guards.test.ts` 报
 * `Test timed out in 120000ms.`，退出码非零 —— 提交被拦下。隔离复跑立刻全绿
 * （32/32，`--no-file-parallelism`）。
 *
 * 口径规范里**早就有**（§13.6.4 / `base-check` 第五态 `load-flake`），缺的是执行者：
 * 那一节的下一动作「隔离复跑定性」此前只有人能做。本文件钉的就是这个执行者。
 *
 * ## 钉什么（四条，两向）
 *
 * 1. 超时指纹的判别式与 `base-check.mjs` 的 `TIMEOUT_SIGNATURES` **逐条同源** ——
 *    两份清单漂移时，同一个红会在「复算工具」里叫 `load-flake`、在钩子里却直接阻断；
 * 2. 真断言红**不复跑**（不带指纹）—— 这是「不把真回归洗成假红」的那一侧，
 *    也是这一档最容易退化的方向（放宽到「是红就复跑」等于放行一切）；
 * 3. 复跑**只能更隔离，不能更松**：`--no-file-parallelism` 且**不许出现任何抬预算的
 *    形态**（`testTimeout` 相关的旗标 / 把 `MAX_WORKERS` 调大）；
 * 4. 复跑**只一次**，且复跑的结果就是该块的结果。
 */
describe("受影响用例的启动器 —— 负载自适应（超时形态自动隔离复跑）", () => {
  const src = readFileSync(LAUNCHER_PATH, "utf8");

  it("超时形态的判别式认得本仓库见到过的每一种原文", () => {
    for (const text of [
      "Test timed out in 120000ms.",
      "Hook timed out in 45000ms.",
      "[vitest-pool]: Failed to start forks worker",
      "Timeout waiting for worker to respond",
      "Exceeded timeout of 2000ms",
      "Timeout - Async callback was not invoked",
      "超时（30s）",
    ]) {
      expect(isTimeoutShaped(text), text).toBe(true);
    }
  });

  it("真断言红 / 起不来都不带指纹 —— 这一档决定「复不复跑」，认错就是放行一切", () => {
    for (const text of [
      "AssertionError: expected 3 to be 4",
      "Test Files 1 failed | 66 passed",
      "Error: Cannot find module 'x'",
      "ERR_MODULE_NOT_FOUND",
      "",
    ]) {
      expect(isTimeoutShaped(text), JSON.stringify(text)).toBe(false);
    }
  });

  it("指纹清单与 base-check 那一份逐条同源（漂移 = 同一件事两个判别式）", () => {
    /* 两份清单是同一件事（「这个红首先是一个负载读数」）在两个执行者上的落地：
     * `base-check` 用它归第五态，启动器用它决定复不复跑。只抄一份正则集合、
     * 而不是从 `base-check` import —— 它是 ESM 且带 CLI 入口，钩子这一层不该为了
     * 一个正则常量去背它的整条依赖链；同源的代价是这一条断言。
     *
     * 读的落点是 `base-check/verdict.mjs` 而不是 `base-check.mjs`：判决那一层
     * 随 R5 拆分搬过去了（`base-check.mjs` 1382 → 648 行），只读主文件时
     * 提取块落空 ⇒ `theirs` 是空数组 ⇒ 这条断言对着空数组比、**静默变成空转**。 */
    /* 读的落点跟着**职责**走：指纹清单随 R5 拆分搬进了
     * `scripts/affected-launch-load-retry.mjs`（`run-affected-tests.mjs` 越过 900 行硬闸，
     * 按「负载归因 vs 起进程」切开）。留在老地方读 ⇒ `pick` 落空 ⇒ 下面那条
     * `mine.length > 0` 当场红 —— 这条断言的意义正在这里，别为了它把清单抄回来。 */
    const launcherLayer = readFileSync(
      "scripts/affected-launch-load-retry.mjs",
      "utf8",
    );
    const baseCheck = readFileSync("scripts/base-check/verdict.mjs", "utf8");
    const pick = (text: string): string[] => {
      const block = /const TIMEOUT_SIGNATURES = \[([\s\S]*?)\n\];/.exec(text);
      return (block?.[1] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("/"))
        .map((line) => line.replace(/,$/, ""));
    };
    const mine = pick(launcherLayer);
    const theirs = pick(baseCheck);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine).toEqual(theirs);
  });

  it("复跑只能更隔离：串行旗标在场，且没有任何抬预算的形态", () => {
    expect(src).toContain('"--no-file-parallelism"');
    // 抬预算那一侧的反向判据（这一档的主要敌人，见 §11.13 / §13.6.4）。
    expect(src).not.toMatch(/testTimeout\s*[:=]\s*\d/);
    expect(src).not.toMatch(/hookTimeout\s*[:=]\s*\d/);
    /* 判的是「**传给 vitest 的实参里**并发只许一处」—— 复跑档不许另起一个更大的
     * `--maxWorkers`。取数的单位是**调用点**（`spawn(entry, [ … ])` 那一段实参），不是
     * 「哪一行同时含 `spawn(` 与 `--maxWorkers=`」：后者钉的是**行形状** —— prettier 把
     * 数组折成多行（例如给首跑/复跑各加一段分文件读数的参数）就会让它读出 0 处，而语义
     * 一个字没变。判据因为排版而红，要修的是判据，不是把代码写回单行去迎合正则
     * （同上面「读的落点是 verdict.mjs」那条对「提取落空 ⇒ 对着空数组比」的提防）。
     *   · 注释 / 文件头说明里的形态不算（提取的是实参段，天然不含它们）；
     *   · 日志话术（`resolveMaxWorkers` 的 `note`）里的同名字符串也不算 —— 它是给人看的
     *     一行提醒，不是并发旋钮，把它算进来会让这条判据变成「谁在提示语里提到并发谁就
     *     红」，而真正的退化（复跑另给一个更大的并发）照样能从实参那一段看出来。
     * 「只许一处」本身不放松：全文件仍只有一处实参带并发旋钮。 */
    const spawnSites = [
      ...src.matchAll(/spawn\(\s*entry,\s*\[([\s\S]*?)\]\s*\)/g),
    ].map((m) => m[1] ?? "");
    expect(
      spawnSites.length,
      "起 vitest 的调用点取不到两处 —— 提取落空会让下面每一条都对着空数组比",
    ).toBeGreaterThanOrEqual(2);
    const workerSites = spawnSites.filter((args) =>
      args.includes("--maxWorkers="),
    );
    expect(
      workerSites,
      `传进 vitest 的并发只该有一处（复跑必须更隔离，不许在这个方向上调）：${workerSites.join(" | ")}`,
    ).toHaveLength(1);
    // 接线到 `resolveMaxWorkers` 的解析结果（首跑的并发由它决定）。
    expect(workerSites[0]).toContain("${workers}");
    // 复跑那一次必须**不含**任何并发旗标（只加隔离，不给旋钮）。
    const retrySite = spawnSites.find((args) =>
      args.includes("--no-file-parallelism"),
    );
    expect(retrySite, "复跑那处实参还在吗？").toBeTruthy();
    expect(retrySite).not.toContain("--maxWorkers");
    /* 分文件读数**不许顶掉人类可读的输出**这件事不在这里判 —— 调用点这一段源码里
     * 只有 `...junitReportArgs(…)`，`--reporter=default` 那两个字面量在函数体里。
     * 判它的地方是下面「写的一侧与读的一侧必须是同一个布局」那一组（直接对函数返回值
     * 判），在这里判会变成「对着源码找一份不在这儿的东西」—— 恒假的那种判据。 */
    /* 读数文件名只许由 `junitReportArgs` 生成：两侧各写一份就会各漂一份，而漂开的形态
     * 是「永远读不到」，在这一格它等价于「这次没有读数」。 */
    for (const args of spawnSites) {
      expect(args).not.toMatch(/comfy-c-/);
    }
  });

  it("触发面：不带指纹时**先于复跑**返回（真断言红一次都不复跑）", () => {
    /* 只切 `runChunk` 里「拿指纹做判断 → 复跑」那一小段：整段数会把上面那条提示
     * 话术一起圈进来，而那句话术里也写着同一个旗标名 —— 于是「复跑被摘掉」
     * 与「只剩日志文字」长得一样。
     * 整条链的**行为**由下一节用注入的假 spawn 整个跑一遍（两向都断退出码），
     * 这里只补一条形状：指纹判在复跑**之前**。 */
    const chunkFn = /export async function runChunk\([\s\S]*?\n\}/.exec(
      src,
    )?.[0];
    expect(chunkFn, "runChunk 还在吗？").toBeTruthy();
    const guard = chunkFn?.indexOf("if (!isTimeoutShaped(res.output))") ?? -1;
    const retry = chunkFn?.indexOf(`"--no-file-parallelism"`) ?? -1;
    expect(guard).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(-1);
    expect(guard, "指纹判断必须在复跑之前").toBeLessThan(retry);
    // 不带指纹那一支必须**返回非零**（不许静默继续）。
    const earlyReturn =
      /if \(!isTimeoutShaped\(res\.output\)\) \{[\s\S]*?return res\.status \?\? 1;/.exec(
        chunkFn ?? "",
      );
    expect(earlyReturn, "不带指纹时应当直接阻断").toBeTruthy();
  });

  it("输出被抓在手里再原样回吐 —— 不抓就分不出「真断言红」与「机器太满」", () => {
    // 判决依赖输出内容，所以失败那一档不能再是 stdio:"inherit"。
    const spawn = /function spawnVitest\(entry, args\) \{[\s\S]*?\n\}/.exec(
      src,
    )?.[0];
    expect(spawn, "spawnVitest 还在吗？").toBeTruthy();
    expect(spawn).toContain('encoding: "utf8"');
    expect(spawn).toMatch(/process\.stdout\.write/);
    expect(spawn).toMatch(/process\.stderr\.write/);
    expect(spawn).not.toMatch(/stdio:\s*"inherit"/);
  });
});

/**
 * 「等负载回落」那一层（本文件上方那节的实测表：load≈300 时连串行都会超时，
 * 所以复跑前必须先看机器还剩多少余量）。
 *
 * 钉三件：负载读数是**每核**口径（阈值才立得住）、等待**有界且不静默**、
 * 等不到时**不放行**（返回 `settled: false`，由调用方按真红处置）。
 */
describe("受影响用例的启动器 —— 等待负载回落（有界、不静默、不放行）", () => {
  const cores = (n: number) => () => Array.from({ length: n }, () => ({}));

  it("负载是**每核**口径 —— 8 核 load=16 与 32 核 load=64 是同一件事", () => {
    expect(loadPerCore({ loadavg: () => [16, 0, 0], cpus: cores(8) })).toBe(2);
    expect(loadPerCore({ loadavg: () => [64, 0, 0], cpus: cores(32) })).toBe(2);
  });

  it("核数读不到时不除以 0（宁可高估负载也不低估）", () => {
    expect(loadPerCore({ loadavg: () => [3, 0, 0], cpus: cores(0) })).toBe(3);
  });

  it("负载已在阈值下 ⇒ 一点不等（否则每次超时都要先白等一轮）", async () => {
    let slept = 0;
    /* 这一层也会往 stderr 打「每核负载 … 等它回落再复跑」（每一跳一行），而这里的
     * 负载是**假探针**给的 —— 那几行进了报告，同样会被读成「这台机器现在很满」。 */
    const { value: res } = await captureStderr(() =>
      waitForLoadToSettle({
        probe: { loadavg: () => [1, 0, 0], cpus: cores(8) },
        sleepFn: () => {
          slept += 1;
        },
      }),
    );
    expect(slept).toBe(0);
    expect(res).toMatchObject({ waitedMs: 0, settled: true });
  });

  it("负载高 ⇒ 等到回落（每一跳都重新读负载，不是盲等固定时长）", async () => {
    /* 读数序列：第一次（进循环前）40 ⇒ 高、睡一跳 ⇒ 30 ⇒ 仍高、再睡 ⇒ 2 ⇒ 落回。
     * 也就是**两跳**。断「读了几次、睡了几跳」而不是断墙钟：这一层判的是
     * 「它在重新测量」，不是「它等了多少秒」。
     *
     * ⚠️ 必须**先 await 完**再断言：`waitForLoadToSettle` 是 async、且它同步执行到
     * 第一个 `await` 就交还控制权 —— 边跑边断只会看到第一跳（实测踩到过：
     * 断言报「只睡了 1 次」，而函数是对的）。 */
    const queue = [40, 30, 2];
    const reads: number[] = [];
    const sleeps: number[] = [];
    const { value: res } = await captureStderr(() =>
      waitForLoadToSettle({
        probe: {
          loadavg: () => {
            const value = queue[Math.min(reads.length, queue.length - 1)] ?? 0;
            reads.push(value);
            return [value, 0, 0];
          },
          cpus: cores(8),
        },
        sleepFn: (ms) => {
          sleeps.push(ms);
        },
      }),
    );
    expect(sleeps).toHaveLength(2);
    expect(reads).toEqual([40, 30, 2]);
    expect(res).toMatchObject({ settled: true });
  });

  it("等不到 ⇒ `settled: false`（**只是优化没兑现**，不再是「按真红上报」）", async () => {
    let ticks = 0;
    const { value: res } = await captureStderr(() =>
      waitForLoadToSettle({
        budgetMs: 3,
        pollMs: 1,
        // 假时钟每跳推进 1ms ⇒ 必然越过 3ms 预算而负载一直很高。
        now: () => ticks,
        sleepFn: () => {
          ticks += 1;
        },
        probe: { loadavg: () => [80, 0, 0], cpus: cores(8) },
      }),
    );
    expect(res).toMatchObject({ settled: false });
  });

  it("启动器真的接了这一步（不是写了一把没人调用的等待）", () => {
    const code = readFileSync(LAUNCHER_PATH, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // 默认档就是真等待 —— 注入只在用例里发生，生产路径必须接上；
    // 且预算由调用点给（多块共享一份 deadline，见下一条）。
    expect(code).toMatch(/const settle =\s*\n?\s*deps\.settle \?\?/);
    expect(code).toMatch(
      /waitForLoadToSettle\(\{ budgetMs: remainingWaitMs\(deps\.waitBudget\) \}\)/,
    );
    expect(code).toMatch(/const settled = await settle\(\);/);
  });

  /* 等待预算**不再逐块各给一份**（ISSUE #1747 的现场：8 块 × 5 分钟 ≈ 31 分钟）。
   * 这条钉的是「收成一份」这件事本身 —— 它此前没有任何判据。 */
  it("等待预算在块之间**共享一份**（不是 5 分钟 × 块数）", () => {
    const deadline = Date.now() + 60_000;
    const left = remainingWaitMs({ deadline });
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(60_000);
    // 过期即 0（不许回退成整份预算 —— 那正是「每块重新拿一份」的形态）。
    expect(
      remainingWaitMs({ deadline: Date.now() - 1 }),
      "过期后不许回退成整份 5 分钟",
    ).toBe(0);
    // 没有 deadline（单块调用 / 用例）时给整份：注入档不许被这条掏空。
    expect(remainingWaitMs(undefined)).toBeGreaterThan(60_000);
  });
});

/**
 * 整条判决链**跑一遍**（注入假的 spawn / 假负载）。
 *
 * 为什么不能只断源码形状：「复跑绿的算过」与「复跑红的也算过」在文本上长得一样，
 * 而后者正是这一档最该拦住的方向（把真回归洗成负载假红 = 门禁静默失效）。
 * 所以这里把 `runChunk` 的真实现整个跑起来，两向都断退出码。
 */
describe("受影响用例的启动器 —— 整条判决链（超时 ⇒ 等待 ⇒ 隔离复跑）", () => {
  const CHUNK = ["tests/a.test.ts", "tests/b.test.ts"];

  /** 一次假 spawn 的结果（与 launcher 里 `spawnVitest` 的返回形状同构）。 */
  type SpawnResult = { status: number | null; output: string };
  /** 一次假 spawn 的调用记录。 */
  type SpawnCall = { entry: string; args: string[] };

  /** 造一个假 spawn：按调用次序回放预设的结果。 */
  function fakeSpawn(results: SpawnResult[]): {
    spawn: (entry: string, args: string[]) => SpawnResult;
    calls: SpawnCall[];
  } {
    const calls: SpawnCall[] = [];
    const spawn = (entry: string, args: string[]): SpawnResult => {
      calls.push({ entry, args: [...args] });
      return results[Math.min(calls.length - 1, results.length - 1)]!;
    };
    return { spawn, calls };
  }

  const TIMEOUT: SpawnResult = {
    status: 1,
    output:
      "Error: Test timed out in 30000ms.\nIf this is a long-running test...",
  };
  const REAL_RED: SpawnResult = {
    status: 1,
    output: "AssertionError: expected 3 to be 4",
  };
  /**
   * 判决粒度换到文件之后（ISSUE #2225），「复跑最多一次」这句原话收窄成更准的一条：
   * **整块只许跑两遍**（并行一遍 + 串行复跑一遍）。第三遍起的是「一份一次」的补跑，
   * 它不是「把整块再测一遍」，而是把第 2 遍那份块级红**拆回文件级**的那一步 ——
   * 不拆的话，同块里一份超时会把别人的真断言红一起降级成「未校验」并退 0。
   */
  const noThirdWholeBlock = (calls: SpawnCall[]) => {
    const blocks = calls.filter(
      (c) => c.args.filter((a) => String(a).endsWith(".test.ts")).length > 1,
    );
    expect(blocks, "整块只许跑两遍：并行一遍 + 串行复跑一遍").toHaveLength(2);
  };
  const GREEN: SpawnResult = { status: 0, output: "Test Files 2 passed" };

  const settledLow = () =>
    Promise.resolve({ settled: true, load: 0.2, waitedMs: 0 });
  const unsettledHigh = () =>
    Promise.resolve({ settled: false, load: 9.5, waitedMs: 300_000 });

  /**
   * 跑一次本块的 `runChunk` 并把它的 stderr **收在手里**。
   *
   * 只判退出码的那些用例也必须走它 —— 理由与「夹具话术不许糊进报告」那一条同源，
   * 写在模块级 `captureStderr` 的头注里（那里有两次实测被误读的读数）。
   */
  async function runCapturing(deps: {
    entry: string;
    workers?: number;
    spawn?: (entry: string, args: string[]) => SpawnResult;
    settle?: () => Promise<{
      settled: boolean;
      load: number;
      waitedMs: number;
    }>;
    waitBudget?: { deadline: number };
    onUnverified?: (files: string[]) => void;
    onAttempt?: (record: {
      outcome: string;
      waitedMs?: number;
      settled?: boolean;
    }) => void;
  }): Promise<{ code: number; text: string }> {
    /* 委托给模块级那一份：抓取的**机制**只许有一处，各写一份就会漂成
     * 「有的调用点抓得到、有的抓不到」（§12.12 / §12.18）。 */
    const { value: code, text } = await captureStderr(() =>
      runChunk(CHUNK, deps),
    );
    return { code, text };
  }

  it("超时 + 隔离复跑绿 ⇒ **通过**（这就是「无论负载如何都能提交」那一半）", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, GREEN]);
    const { code } = await runCapturing({
      entry: "vitest.mjs",
      spawn,
      settle: settledLow,
    });
    expect(code).toBe(0);
    // 第一次并行、第二次必须串行（更隔离，不是更松）。
    expect(calls).toHaveLength(2);
    const first = calls[0];
    const second = calls[1];
    expect(first?.args.join(" ")).toContain("--maxWorkers=");
    expect(first?.args.join(" ")).not.toContain("--no-file-parallelism");
    expect(second?.args).toContain("--no-file-parallelism");
    // 两次的清单必须是同一份（「重测」不是「换一批」）。
    const rest = (second?.args ?? []).slice(
      (second?.args ?? []).indexOf("--no-file-parallelism") + 1,
    );
    expect(rest).toEqual(CHUNK);
  });

  it("真断言红 ⇒ **一次都不复跑**、直接阻断（不把真回归洗成负载假红）", async () => {
    const { spawn, calls } = fakeSpawn([REAL_RED, GREEN]);
    const { code } = await runCapturing({
      entry: "vitest.mjs",
      spawn,
      settle: settledLow,
    });
    expect(code).toBe(1);
    expect(calls, "不带超时指纹时不该有第二次调用").toHaveLength(1);
  });

  it("第二遍指纹消失（真断言 / 真挂死）⇒ 阻断 —— 「未校验」这一档不许把它洗掉", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, REAL_RED]);
    const { code } = await runCapturing({
      entry: "vitest.mjs",
      spawn,
      settle: settledLow,
    });
    expect(code).toBe(1);
    noThirdWholeBlock(calls);
  });

  /* 这一格是本文件里最要紧的语义变更（ISSUE #1747）：**「拿不到测量」不等于
   * 「测量结果是红的」**。第二遍**也**只是超时形态 ⇒ 失败的是调度、没有任何一条
   * 断言报错 ⇒ 记为「未校验」：放行 + 点名，而不是把提交拦下。
   * 旧口径（负载没回落就阻断）把「机器忙」变成了提交者无法修的失败。 */
  it("两遍都只是超时形态 ⇒ **未校验、放行**（并逐条点名哪几份没被校验）", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, TIMEOUT]);
    const unverified: string[][] = [];
    const { code, text } = await runCapturing({
      entry: "vitest.mjs",
      spawn,
      settle: unsettledHigh,
      onUnverified: (files: string[]) => unverified.push([...files]),
    });
    expect(code, "未校验不是红：提交继续").toBe(0);
    noThirdWholeBlock(calls);
    expect(unverified, "放行必须带出「哪几份没被校验」").toEqual([CHUNK]);
    expect(text, "话术要明说它不是绿").toMatch(/未校验/);
    expect(text, "没有证据说它通过，就不许把它说成负载假红").not.toMatch(
      /隔离复跑全绿/,
    );
  });

  /* 这一档**放行**，所以它的唯一产物就是收尾那段报告 —— 报告没印出来（或印得含糊），
   * 放行就退化成「静默通过」（同 §11.23：写了没有读者等于没写）。 */
  it("未校验的收尾报告**逐条点名**那些文件，且不许把它说成通过", () => {
    const text = unverifiedReport(["tests/a.test.ts", "tests/b.test.ts"]);
    expect(text).toContain("2 份用例");
    expect(text).toContain("tests/a.test.ts");
    expect(text).toContain("tests/b.test.ts");
    // 复验出口必须在（否则「未校验」有结论没动作）。
    expect(text).toMatch(/--full/);
    expect(text, "不许读成「已通过」").not.toMatch(/已通过|全部通过/);
  });

  it("未校验那一格与「负载有没有回落」解耦 —— 等待没兑现不改变结论", async () => {
    const settled: { settled: boolean; load: number; waitedMs: number } = {
      settled: true,
      load: 0.2,
      waitedMs: 0,
    };
    const codes: number[] = [];
    for (const s of [settledLow, () => Promise.resolve(settled)]) {
      const { spawn } = fakeSpawn([TIMEOUT, TIMEOUT]);
      const { code } = await runCapturing({
        entry: "vitest.mjs",
        spawn,
        settle: s,
      });
      codes.push(code);
    }
    expect(codes, "负载回落与否都不判红").toEqual([0, 0]);
  });

  it("第一遍就绿 ⇒ 只调一次，且不等、不复跑", async () => {
    const { spawn, calls } = fakeSpawn([GREEN]);
    let settledCalls = 0;
    const { code } = await runCapturing({
      entry: "vitest.mjs",
      spawn,
      settle: () => {
        settledCalls += 1;
        return settledLow();
      },
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(settledCalls, "绿的那一档不该付等待的钱").toBe(0);
  });

  it("整块第三次不许有：串行红之后只按「一份一次」把判决粒度拿回来", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, TIMEOUT, GREEN]);
    await runCapturing({
      entry: "vitest.mjs",
      spawn,
      settle: settledLow,
    });
    noThirdWholeBlock(calls);
    /* 补跑的每一份都只带一份文件，且总次数不超过「整块两遍 + 每份一次」。 */
    const extras = calls.slice(2);
    for (const one of extras) {
      expect(
        one.args.filter((a) => String(a).endsWith(".test.ts")),
      ).toHaveLength(1);
    }
    expect(calls.length).toBeLessThanOrEqual(2 + CHUNK.length);
  });

  /**
   * 「等了多久」必须说出口。这一格是**唯一**能区分
   * 「机器空了 ⇒ 第二遍与第一遍不同条件」与「一点没等 ⇒ 第二遍与第一遍同条件」的读数，
   * 而后者意味着这次复跑只证伪了「真断言红」、**没有**排除负载。
   * `waitForLoadToSettle` 一直在算 `waitedMs`，只是从没打印过 —— 算了不说，
   * 与没算在读数上等价（同 §11.23「写了没有读者等于没写」）。
   */
  it("等了 ⇒ 报「等了 42.0s」；一点没等 ⇒ 说「没等」并明说它不能证明负载已散", async () => {
    const waited = await runCapturing({
      entry: "vitest.mjs",
      spawn: fakeSpawn([TIMEOUT, GREEN]).spawn,
      settle: () =>
        Promise.resolve({ settled: true, load: 0.4, waitedMs: 42_000 }),
    });
    expect(waited.text).toContain("等了 42.0s");
    expect(waited.text).toContain("每核负载回落到 0.40");
    expect(waited.text).toContain("起第 2 遍");

    const noWait = await runCapturing({
      entry: "vitest.mjs",
      spawn: fakeSpawn([TIMEOUT, GREEN]).spawn,
      settle: settledLow,
    });
    expect(noWait.text).toContain("没等");
    expect(noWait.text).toContain("不能证明负载已散");
    // 两格必须是**读得出区别**的两种形状：等了的那格不许说「没等」，反之亦然
    // —— 否则「等了多久」这一格在日志里就等于没有。
    expect(waited.text).not.toContain("没等");
    expect(noWait.text).not.toContain("等了 ");
  });

  it("每一块的判决都进收尾那份账：五种结局各记一条，且不影响退出码", async () => {
    const seen: string[] = [];
    const onAttempt = (r: { outcome: string }) => seen.push(r.outcome);
    const once = async (results: SpawnResult[], settle = settledLow) =>
      runCapturing({
        entry: "vitest.mjs",
        spawn: fakeSpawn(results).spawn,
        settle,
        onAttempt,
      });
    await once([GREEN]);
    await once([TIMEOUT, GREEN]);
    await once([TIMEOUT, TIMEOUT]);
    await once([REAL_RED]);
    await once([TIMEOUT, REAL_RED]);
    expect(seen).toEqual([
      "first-green",
      "rerun-green",
      "rerun-unverified",
      "red-no-fingerprint",
      "real-red",
    ]);
    // 记账只喂读数：未校验那两块照样放行（0），真红那两块照样阻断（非 0）。
    const codes: number[] = [];
    const cases: SpawnResult[][] = [
      [GREEN],
      [TIMEOUT, GREEN],
      [TIMEOUT, TIMEOUT],
      [REAL_RED],
      [TIMEOUT, REAL_RED],
    ];
    for (const results of cases) {
      codes.push((await once(results)).code);
    }
    expect(codes).toEqual([0, 0, 0, 1, 1]);
  });

  /* 「话术不许糊进报告」这件事本身要有读者 —— 上面每一条都**自觉地**走了 `runCapturing`，
   * 而下一条新用例忘了走的时候，没有任何一条断言会红，只有读报告的人会看到一段
   * 「未校验 / 真红」而以为那是真跑的结论（平台侧 `cnb-n1j-1k5ct202i` 第 9 格就是这么
   * 被读错的）。同一族还有 `waitForLoadToSettle` 的「每核负载 …」—— 那一行里的负载
   * 是假探针给的，进了报告同样会被读成「这台机器现在很满」。
   *
   * 所以判的是**调用点的形状**：本文件里不许有「直接 await 这两个函数」那种写法 ——
   * 走了 `runCapturing` / `captureStderr` 的那几处都不是这个形状。 */
  it("本文件不许出现没接住 stderr 的调用点（夹具话术不许进报告）", () => {
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    /* 针尖按**拼接**构造：把它整段写成字面量的话，这条断言会命中它自己（恒红 ——
     * 而恒红的判据比没有更坏，下一个人学到的动作是「先把它删掉」）。 */
    const leaky = new RegExp(
      `await\\s+(${["runChunk", "waitForLoadToSettle"].join("|")})\\(`,
    );
    expect(self, "本文件读不到 —— 路径/文件名变了？").toContain("runChunk(");
    expect(
      leaky.test(self),
      "有调用点没接住 stderr：它的判决话术会以「真跑的结论」的形态出现在报告里",
    ).toBe(false);
  });
});

/**
 * 收尾那份「等待与复跑账」（钩子重构 3）。
 *
 * 立案现场：判决链把「重测一次」机器化之后，**这次总共等了多久、放行的是第几遍测出来的、
 * 放行时它到底是绿还是「未校验」**这三格只剩在散落行里 —— 人被放行（或被拦下）之后
 * 答不出这三问，而「负载假红」与「真回归」在人嘴里的分界就是这三问。
 * 更要紧的是账本里那条实测：C 组中位 207s 对地板 141s，多出来的那一段就是等待 + 复跑，
 * 而钩子从没把它单独报出来过 ⇒ 看账的人只能把「慢」归给判据。
 */
describe("受影响用例的启动器 —— 收尾的等待与复跑账", () => {
  const BUDGET = { budgetMs: 5 * 60_000 };

  it("一块都没复跑 ⇒ **空串**（绿的那一大半不该为这段账付输出）", () => {
    expect(
      rerunReport(
        [{ outcome: "first-green" }, { outcome: "red-no-fingerprint" }],
        BUDGET,
      ),
    ).toBe("");
  });

  it("复跑过 ⇒ 报「累计/预算、第几遍、绿还是未校验」，且不许把放行写成通过", () => {
    const text = rerunReport(
      [
        { outcome: "first-green" },
        { outcome: "red-no-fingerprint" },
        { outcome: "rerun-green", waitedMs: 42_000, settled: true },
        { outcome: "rerun-unverified", waitedMs: 180_000, settled: false },
        { outcome: "rerun-unattributed", waitedMs: 60_000, settled: true },
      ],
      BUDGET,
    );
    expect(text).toContain("第 1 遍直接绿 1 块");
    expect(text).toContain("红而不带超时指纹（真红，一次都不复跑）1 块");
    expect(text).toContain("带指纹复跑 3 块");
    /* 预算报的是**整次提交一份**那个数（逐块计就是 5 分钟 × N，实测 8 块压到 31 分钟）。 */
    expect(text).toContain(
      "等待累计 282.0s / 预算 300.0s（**整次提交一份**，不是每块一份）",
    );
    expect(text).toContain("没等到回落 1 块");
    expect(text).toContain("**第 2 遍**的结果：负载假红放行 1 块");
    expect(text).toContain("**未校验**（每份都只是超时形态）1 块");
    /* 「未判定」必须有自己的一格：账上只列 0/1 两档时，退 2 那些块会读成「没发生过」
     * —— 那正是 ISSUE #2225 的假绿在账本上的形状。 */
    expect(text).toContain("**未判定**（有份拿不到自己的读数）1 块");
    expect(text).toContain("「放行」不等于「通过」");
    expect(text).toContain("连「每份都只是超时」都没确认到");
    expect(text).not.toMatch(/已通过|全部通过|测试通过/);
  });

  it("真红那一格在账里也是**阻断**，不许被前面两格的「放行」语气盖掉", () => {
    const text = rerunReport(
      [{ outcome: "real-red", waitedMs: 5_000, settled: true }],
      BUDGET,
    );
    expect(text).toContain("真红 1 块");
    expect(text).toContain("等待累计 5.0s");
  });

  it("main 在**真红那条提前返回之前**也打这份账（否则被拦下的那次恰好没有账）", () => {
    /* 与上面 `scopeAdvice`「在起 vitest 之前打」是同一条教训：把账挂在正常收尾那一行，
     * 真红时 `return code` 会把它整段跳过 —— 而那一次正是最需要知道
     * 「等了多久、哪几块没被校验」的时候。实测形态：账上只有绿的记录，红的没有。 */
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toContain("const flush = () =>");
    const early = /if \(code !== 0\) \{([\s\S]*?)return code;/.exec(src);
    expect(early, "main 里那条提前返回的形状变了？").toBeTruthy();
    expect(early?.[1]).toContain("flush()");
    // 正常收尾那一侧也要打（两块都缺一段就退化成「只在红的时候有账」）。
    const tail = src.slice(src.lastIndexOf("flush();"));
    expect(tail).toContain("return 0;");
  });
});

describe("钩子档并发：兜底由调用点注入（唯一出处 ci-load），且有只调并发的显式覆盖口", () => {
  it("缺省 / 空串都落到**注入的那个兜底**，且不带任何提醒", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(resolveMaxWorkers(raw, 3)).toEqual({ workers: 3, note: null });
    }
  });

  it("兜底漏传就当**没跑起来** —— 不许静默退回某个数字（ISSUE #2324 收口的那一族）", () => {
    /* 这里以前是一条 `DEFAULT_MAX_WORKERS = 4`：与 `vitest.config.ts` 的 8、`ci-load.mjs`
       的按核折算凑成同一句判断的三份副本，于是「单条链别占满整台机」那一档压住了平台
       两格、本地那一跳照旧铺开。默认值撤掉之后，漏传必须**响**。 */
    for (const bad of [undefined, null, 0, -1, 2.5, Number.NaN, "2"]) {
      expect(
        () => resolveMaxWorkers("2", bad as unknown as number),
        `兜底 ${String(bad)} 必须停手`,
      ).toThrow(/兜底/);
    }
  });

  it("env 与兜底都由调用点读入（纯函数既不碰 process.env，也不自己算核数）", () => {
    /* 这一格防的是「用例进程自己继承到的环境变量把默认档那一格污染掉」——
       解析器一旦自己兜底 `process.env`，本文件在 `COMFY_PRECOMMIT_MAX_WORKERS=2`
       下跑时「不给值＝走兜底」会假红，而那种失效长的样子是「判据真的坏了」。
       第二件同理：核数只在 `ci-load.mjs` 读，调用点把结果传进来（#2324）。 */
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toMatch(
      /resolveMaxWorkers\(\s*\n?\s*process\.env\.COMFY_PRECOMMIT_MAX_WORKERS,\s*\n?\s*resolveCiWorkers\(\)\.workers,/,
    );
    // 函数体里不许再出现 process.env，也不许自己 import 核数（那会让它不再纯）。
    const body = /export function resolveMaxWorkers\(([\s\S]*?)\n\}/.exec(src);
    expect(body, "解不出 resolveMaxWorkers 的函数体").not.toBeNull();
    expect(body![1]).not.toContain("process.env");
    expect(body![1]).not.toContain("availableParallelism");
  });

  it("显式覆盖生效，且提醒里说清「只调并发」", () => {
    const r = resolveMaxWorkers("1", 2);
    expect(r.workers).toBe(1);
    expect(r.note).toContain("只调并发");
    // 覆盖成兜底值本身不提醒：说了等于没说。
    expect(resolveMaxWorkers("2", 2).note).toBeNull();
  });

  it("非法值按兜底办并提醒 —— 不许静默降级成 0（那会让 vitest 报错指不到真因）", () => {
    for (const raw of ["0", "-2", "abc", "2.5", "NaN"]) {
      const r = resolveMaxWorkers(raw, 2);
      expect(r.workers, `${raw} 应落回兜底`).toBe(2);
      expect(r.note, `${raw} 应有一条提醒`).toContain("不是 ≥1 的整数");
    }
  });

  it("覆盖值真的进了 vitest 的命令行（不是只解析不接线）", () => {
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toMatch(/--maxWorkers=\$\{workers\}/);
    expect(src).not.toMatch(/--maxWorkers=\$\{MAX_WORKERS\}/);
  });
});

/**
 * 第二条档位：`--full`（显式全量）。
 *
 * 这一档的存在理由不是「多一个开关」，而是规范 §13.5.8 写下的**重开条件**：
 * `affected-tests.mjs` 命中公共地基时会放弃收窄、只跑固定清单，而这条兜底此前
 * **没有具名出口**（「翻兜底的前置是先造一条显式的全量通道」）。缺了它，wide 那一档
 * 遇到 `vitest.config.ts` / lockfile 的改动就只能「跑 68 个、然后没人知道全量怎么跑」。
 *
 * 与上面那条空清单守卫是**相反方向**的两件事，所以这里要同时钉住：
 *   · `--full` 是**按名字**要全量 —— 它必须**不**经暂存区解析、**不**拼位置参数；
 *   · 「谁都没筛过」的意外空集**仍然阻断** —— 两者绝不许在退出码上同形。
 */
describe("受影响用例的启动器 —— 显式全量档（--full）", () => {
  const src = readFileSync(LAUNCHER_PATH, "utf8");

  it("`--full --dry-run` 走**另一条**分支：真跑一次，输出里没有增量清单的读数", () => {
    /* 按**行为**判，不按源码文本判：文本判据在 `const full = false && argv.includes("--full")`
       这种变异下照样绿（字符串还在），而那种变异恰恰就是「这一档被静音」。
       所以这里真起一次进程，两档各跑一遍，看输出形态。
       注意用 `--dry-run`：它既走完整条分支选择，又不真起 vitest。 */
    const full = spawnSync(
      process.execPath,
      [LAUNCHER_PATH, "--full", "--dry-run"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(full.status, `${full.stdout ?? ""}${full.stderr ?? ""}`).toBe(0);
    expect(full.stderr).toContain("--full：按名字要全量");
    // 增量档那句「N 个用例 / M 次启动」在全量档里**不该出现** —— 出现了说明它先解析了清单。
    expect(full.stdout + full.stderr).not.toMatch(/个用例 \/ \d+ 次启动/);

    const inc = spawnSync(process.execPath, [LAUNCHER_PATH, "--dry-run"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(inc.status, `${inc.stdout ?? ""}${inc.stderr ?? ""}`).toBe(0);
    expect(inc.stdout, "增量档应当给出清单与启动次数").toMatch(
      /个用例 \/ \d+ 次启动/,
    );
    expect(inc.stderr, "两档的话术必须可分辨").not.toContain(
      "--full：按名字要全量",
    );
  });

  it("`--full` 复用同一条判决链（`runChunk([], …)`）—— 不另写一套跑法", () => {
    /* 空位置参数在这里是**明确意图**（vitest 自行收集全部），与「谁都没筛过」在代码上
       就是同一行 `runChunk([])`；这条断言把它钉成「有意的复用」而不是巧合。
       复用带来的是超时形态的负载自适应仍然在场 —— 全量档不该成为「机器太满」的结论出口。 */
    /* reporter 那一档（`quiet`）是**读数**上的选择，不是另写一套跑法：它跟着同一个
       `runChunk` 走 —— 所以这条形状判据把 `quiet` 也算进同一行里。 */
    expect(src).toMatch(
      /return await runChunk\(\[\], \{ entry, workers, quiet: \w+ \}\)/,
    );
  });

  it("意外空集仍阻断，且话术里指出 `--full` 是另一档（两者不许同形）", () => {
    const guard = /affected 解析没给出清单([\s\S]*?)return 1;/.exec(src)?.[0];
    expect(guard, "解不出空清单守卫").toBeTruthy();
    expect(guard).toContain("--full");
    expect(
      guard,
      "空集必须仍然 return 1（不能因为 --full 存在就放行）",
    ).toContain("return 1;");
  });

  it("`--full` **不接进钩子**（钩子只有增量档）", () => {
    const hook = readFileSync(HOOK_PATH, "utf8");
    const body = cGroupBody(hook);
    expect(body).toContain("run-affected-tests.mjs");
    expect(
      body,
      "钩子里不许出现 --full：那会把每次提交变成整份套件的仪式",
    ).not.toContain("--full");
  });

  it("wide 话术指名的就是这条命令，且它真的存在于入口（不是写了一段跑不响的话）", () => {
    /* 两半一起钉才成立：前半是「话术里有这条出口」，后半是「那个出口在入口里认这个旗标」。
       只钉前半 = 守一句散文；只钉后半 = 守一个没人知道的开关。 */
    const note = wideFallbackNote("门槛自身", 20);
    expect(note).toContain("scripts/run-affected-tests.mjs --full");
    expect(src, "入口不认 --full，话术就指到空气上").toContain(
      'argv.includes("--full")',
    );
  });

  it("`--full` **不是**全量那一档（它不带覆盖率门槛，也不记那份账）", async () => {
    /* 这一条判的是「两条全量通道不许被读成一件事」——它是本轮差点踩进去的坑：
     * 看到 `--full` 这个名字就顺手让它去写 `scripts/.full-suite-freshness.json`
     *（甚至替掉 `full-suite-run.mjs`），那条账记的就变成**没跑过覆盖率门槛**的一次了。
     *
     * 差异是实的、不是措辞：
     *   · `pnpm run test:coverage`（= `full-suite-run.mjs`）= 全量用例 **+ `--coverage`
     *     的 thresholds**（§11.7 明写覆盖率门槛只在这一档判）；
     *   · `--full` = `runChunk([], …)` → `vitest run`，**没有** `--coverage`。
     * 所以 `--full` 绿不代表覆盖率门槛过了，它**不该**记账 —— 记了就是把
     * 「跑过全量」与「过过覆盖率门槛」混成一件（同 `full-suite-run.mjs` 里那句
     * 「红着记一条『我跑过』会把两件事混成一件」的反面形态）。
     *
     * 两侧都判：入口不记账 + 记账通道只挂在 `test:coverage` 上。只判一侧的话，
     * 另一侧哪天被改就成了「判据看着有、其实只守住了半条缝」。 */
    expect(
      src,
      "`--full` 去写全量新鲜度账 = 用一条不过覆盖率门槛的跑法冒充那一档",
    ).not.toMatch(/freshness|full-suite-run/);

    /* 判**语义**不判行形状：拿 `planRun()` 真跑一次读它给出的参数，而不是在源码文本里
     * 找一句 `"run", "test:coverage"` —— 那个字面量会被 prettier 折行顶掉（本仓踩过第二次），
     * 而折行不改任何行为，红出来的是一条假红。 */
    const { planRun } = await import("../scripts/full-suite-run.mjs");
    const plan = planRun();
    expect(
      plan.args.slice(0, 2),
      "全量那一档的记账通道必须挂在 `pnpm run test:coverage` 上，而不是随便一个 vitest 跑法",
    ).toEqual(["run", "test:coverage"]);
  });
});

describe("组 C 的分文件读数：写的一侧与读的一侧必须是同一个布局", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** @returns {string} */
  function tempDir() {
    const dir = mkdtempSync(path.join(tmpdir(), "affected-junit-"));
    dirs.push(dir);
    return dir;
  }

  it("没有账本目录 ⇒ 一个字都不加（人自己跑这一档不该被塞读数）", () => {
    expect(junitReportArgs("", 0, 1)).toEqual([]);
  });

  it("首跑与复跑各落一份，且 default reporter 不许被顶掉", () => {
    const dir = tempDir();
    const first = junitReportArgs(dir, 0, 1);
    const retry = junitReportArgs(dir, 0, 2);
    /* 只给 junit 会把人类可读的输出整个换掉 —— 而真红那一屏是唯一能读的东西。
     * 这一条钉的是「加读数不许替代判定与输出」。 */
    expect(first).toContain("--reporter=default");
    expect(first).toContain("--reporter=junit");
    expect(first.at(-1)).toContain("comfy-c-0-1.xml");
    expect(String(retry.at(-1))).toContain("comfy-c-0-2.xml");
    /* 两块不能共用一个文件：同一份清单在两遍里是两组条件不同的读数。 */
    expect(first.at(-1)).not.toBe(retry.at(-1));
  });

  it("quiet 档 + 账本 ⇒ 只叠 junit，不再塞 default（同一跑不打两遍）", () => {
    const dir = tempDir();
    /* quiet 已经给了人读的出口（`--reporter=dot`）；再叠一个 default 会把整屏打印两遍，
     * 而那正是 102400 字节日志预算要压掉的那一屏（ISSUE #2074 的连带缺陷）。 */
    const args = junitReportArgs(dir, 0, 1, { withDefaultReporter: false });
    expect(args).toContain("--reporter=junit");
    expect(args).not.toContain("--reporter=default");
  });

  it("quiet + 账本：两遍的 reporter 都是 dot + junit，且没有 default", async () => {
    const dir = tempDir();
    const calls: string[][] = [];
    await captureStderr(() =>
      runChunk(["tests/a.test.ts"], {
        entry: "vitest.mjs",
        quiet: true,
        junitDir: dir,
        chunkId: 3,
        spawn: (_e: string, args: string[]) => {
          calls.push(args);
          return calls.length === 1
            ? { status: 1, output: "Test timed out in 30000ms" }
            : { status: 0, output: "" };
        },
        settle: async () => ({ settled: true, load: 0.1, waitedMs: 1 }),
      }),
    );
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      expect(args).toContain("--reporter=dot");
      expect(args).toContain("--reporter=junit");
      expect(args).not.toContain("--reporter=default");
    }
    expect(calls[0]?.join(" ")).toContain("comfy-c-3-1.xml");
    expect(calls[1]?.join(" ")).toContain("comfy-c-3-2.xml");
  });

  it("runChunk 真的把这两段拼进两次 spawn，清单仍在最后", async () => {
    const dir = tempDir();
    const calls: { entry: string; args: string[] }[] = [];
    await captureStderr(() =>
      runChunk(["tests/a.test.ts"], {
        entry: "vitest.mjs",
        junitDir: dir,
        chunkId: 7,
        spawn: (_entry: string, args: string[]) => {
          calls.push({ entry: _entry, args });
          return calls.length === 1
            ? { status: 1, output: "Test timed out in 30000ms" }
            : { status: 0, output: "" };
        },
        settle: async () => ({ settled: true, load: 0.1, waitedMs: 1 }),
      }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.join(" ")).toContain("comfy-c-7-1.xml");
    expect(calls[1]?.args.join(" ")).toContain("comfy-c-7-2.xml");
    /* 位置也钉一下：reporter 段在清单之前 —— 追加到尾部会被当成 vitest 的位置参数。 */
    expect(calls[0]?.args.indexOf("--reporter=default")).toBe(1);
    expect(calls[0]?.args.at(-1)).toBe("tests/a.test.ts");
  });

  it("清单落盘 + 读账读得到（两侧对同一布局的往返，改一边就该红）", () => {
    const dir = tempDir();
    expect(
      writeFilesManifest(dir, ["tests/a.test.ts", "tests/b.test.ts"]),
    ).toBe(true);
    const xml = junitReportArgs(dir, 0, 1).at(-1) ?? "";
    const file = xml.replace("--outputFile.junit=", "");
    writeFileSync(
      file,
      `<?xml version="1.0"?>\n<testsuites name="vitest tests" time="2">\n` +
        `<testsuite name="tests/a.test.ts" time="1.25"></testsuite>\n</testsuites>\n`,
      "utf8",
    );
    const got = collectFileTimings({ dir });
    expect(got.files).toEqual([{ name: "tests/a.test.ts", ms: 1250 }]);
    expect(got.expected).toBe(2);
    expect(got.missing).toBe(1);
  });

  it("清单写不进去（目录不存在）⇒ 回 false，不抛、也不冒充已落", () => {
    expect(
      writeFilesManifest(path.join(tmpdir(), "comfy-不存在的一层"), ["a"]),
    ).toBe(false);
    expect(junitReportArgs(undefined, 0, 1)).toEqual([]);
  });
});

describe("隔离复跑的复跑面（只重跑失败的那几份）", () => {
  const CHUNK = ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"];

  /** 写一份第 1 遍的 junit 读数到临时账本目录，返回该目录。 */
  function firstPassXml(dir: string, body: string): string {
    writeFileSync(
      cFileXmlName(dir, 0, 1),
      `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="3">${body}</testsuites>\n`,
    );
    return dir;
  }
  const suite = (name: string, failures: number, errors = 0) =>
    `<testsuite name="${name}" tests="1" failures="${failures}" errors="${errors}" time="0.4"></testsuite>`;

  it("第 1 遍有 2 份失败 ⇒ 复跑面就是那 2 份（顺序按本块清单）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-scope-"));
    try {
      firstPassXml(
        dir,
        suite("tests/c.test.ts", 1) +
          suite("tests/a.test.ts", 0, 1) +
          suite("tests/b.test.ts", 0),
      );
      const got = retryScope({ chunk: CHUNK, junitDir: dir, chunkId: 0 });
      expect(got.files).toEqual(["tests/a.test.ts", "tests/c.test.ts"]);
      expect(got.why).toContain("2/3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("墙钟界已过 ⇒ 第二遍**根本没开**：退 2（未判定），名单只有复跑面", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-clock-"));
    try {
      firstPassXml(
        dir,
        suite("tests/a.test.ts", 1) +
          suite("tests/b.test.ts", 0) +
          suite("tests/c.test.ts", 1),
      );
      const TIMEOUT = {
        status: 1,
        output: "Error: Test timed out in 30000ms.",
      };
      const calls: string[][] = [];
      const outcomes: string[] = [];
      const { value: code, text } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: (_entry: string, args: string[]) => {
            calls.push(args.filter((a) => a.endsWith(".test.ts")));
            return TIMEOUT;
          },
          settle: () =>
            Promise.resolve({ settled: true, load: 0.1, waitedMs: 9_999 }),
          stageBudget: { deadline: Date.now() - 1, budgetMs: 1 },
          onAttempt: (r) => outcomes.push(r.outcome),
        }),
      );
      /* 只起了一次进程 = 第二遍根本没开；界已过时连「等机器喘口气」都不该付 ——
       * 等来的那一遍本来就不会开。 */
      expect(calls, "界已过时第二遍一次都不许起").toHaveLength(1);
      expect(code).toBe(2);
      expect(outcomes).toEqual(["budget-skipped"]);
      expect(text).toContain("第 2 遍不开");
      /* 名单必须是复跑面那两份：第一遍就绿的 b 不许被写成没结论。 */
      expect(text).toContain("· tests/a.test.ts");
      expect(text).toContain("· tests/c.test.ts");
      expect(text).not.toContain("· tests/b.test.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("界还够 ⇒ 第二遍照开（反向对照：这条判点不许退化成「永远不开」）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-clock-"));
    try {
      firstPassXml(
        dir,
        suite("tests/a.test.ts", 1) +
          suite("tests/b.test.ts", 0) +
          suite("tests/c.test.ts", 1),
      );
      const TIMEOUT = {
        status: 1,
        output: "Error: Test timed out in 30000ms.",
      };
      const GREEN = { status: 0, output: "Test Files 2 passed" };
      const calls: string[][] = [];
      const outcomes: string[] = [];
      const { value: code } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: (_entry: string, args: string[]) => {
            calls.push(args.filter((a) => a.endsWith(".test.ts")));
            return calls.length === 1 ? TIMEOUT : GREEN;
          },
          settle: () =>
            Promise.resolve({ settled: true, load: 0.2, waitedMs: 1_000 }),
          stageBudget: wallClockBudget({
            startMs: Date.now(),
            budgetMs: 60 * 60 * 1000,
          }),
          onAttempt: (r) => outcomes.push(r.outcome),
        }),
      );
      expect(calls, "界够时必须照旧起第二遍").toHaveLength(2);
      expect(calls[1]).toEqual(["tests/a.test.ts", "tests/c.test.ts"]);
      expect(code).toBe(0);
      expect(outcomes).toEqual(["rerun-green"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("读数里的陌生路径不许进复跑面（它不属于这一块，跑它会改判据的分母）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-scope-"));
    try {
      firstPassXml(
        dir,
        suite("tests/zzz.test.ts", 1) + suite("tests/b.test.ts", 1),
      );
      expect(
        retryScope({ chunk: CHUNK, junitDir: dir, chunkId: 0 }).files,
      ).toEqual(["tests/b.test.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("三种「读不出来」一律退回整块 —— 宁可多跑，也不许漏跑一份真失败的文件", () => {
    /* ① 不在钩子里跑（没有账本目录）。 */
    const noDir = retryScope({ chunk: CHUNK });
    expect(noDir.files).toEqual(CHUNK);
    expect(noDir.why).toContain("没有账本目录");

    const dir = mkdtempSync(path.join(tmpdir(), "c-scope-"));
    try {
      /* ② 文件没落盘。 */
      const missing = retryScope({ chunk: CHUNK, junitDir: dir, chunkId: 0 });
      expect(missing.files).toEqual(CHUNK);
      expect(missing.why).toContain("取不到");

      /* ③ 读到了却一份失败都没有：崩在 suite 之前 / reporter 没记上。
       *    这一档与「这次清单本来就这么点」逐字同形，所以只能按最贵的算。 */
      firstPassXml(
        dir,
        suite("tests/a.test.ts", 0) + suite("tests/b.test.ts", 0),
      );
      const empty = retryScope({ chunk: CHUNK, junitDir: dir, chunkId: 0 });
      expect(empty.files).toEqual(CHUNK);
      expect(empty.why).toContain("没有");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("整条链：超时形态 ⇒ 第 2 遍只带失败那 1 份，且「未校验」点名的也是那 1 份", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-chain-"));
    try {
      firstPassXml(
        dir,
        suite("tests/a.test.ts", 1) + suite("tests/b.test.ts", 0),
      );
      const TIMEOUT = {
        status: 1,
        output:
          "Error: Test timed out in 30000ms.\nIf this is a long-running test...",
      };
      const GREEN = { status: 0, output: "Test Files 1 passed" };
      const calls: string[][] = [];
      const unverified: string[][] = [];
      const { value: code } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: (_entry: string, args: string[]) => {
            calls.push(args.filter((a) => a.endsWith(".test.ts")));
            return calls.length === 1 ? TIMEOUT : GREEN;
          },
          settle: () =>
            Promise.resolve({ settled: true, load: 0.2, waitedMs: 1_200 }),
          onUnverified: (files: string[]) => unverified.push([...files]),
        }),
      );
      expect(code).toBe(0);
      /* 第 1 遍是整块（判决还没发生），第 2 遍收窄到失败的那一份。 */
      expect(calls[0]).toEqual(CHUNK);
      expect(calls[1]).toEqual(["tests/a.test.ts"]);
      /* 没跑过第 2 遍的 b/c 不能被写成「未校验」—— 它们第一遍就绿了。 */
      expect(unverified).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("第 2 遍仍只是超时形态 ⇒ 点名的名单是复跑面，不是整块", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-chain-"));
    try {
      firstPassXml(
        dir,
        suite("tests/a.test.ts", 1) + suite("tests/b.test.ts", 0),
      );
      const TIMEOUT = {
        status: 1,
        output: "Error: Test timed out in 30000ms.",
      };
      const unverified: string[][] = [];
      const { value: code } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: () => TIMEOUT,
          settle: () =>
            Promise.resolve({ settled: true, load: 0.1, waitedMs: 800 }),
          onUnverified: (files: string[]) => unverified.push([...files]),
        }),
      );
      /* 未校验 ⇒ 放行（退 0），但名单必须只有那一份。 */
      expect(code).toBe(0);
      expect(unverified).toEqual([["tests/a.test.ts"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ── 判决粒度：第 2 遍那份红要**按文件**分开（ISSUE #2225）──────────────────────
 *
 * 复跑面早就按文件了（上面那节），判决却还停在块级：`isTimeoutShaped(retry.output)`
 * 读的是整块输出，于是「A 超时 + B 真断言红」被整块读成「只是超时形态」⇒ 退 0 ⇒
 * `ci-affected-tests.mjs` 把这个 0 原样透传成平台 stage 的 success —— B 那次真红
 * 没有任何一格会看见。下面这几条判的就是那一型：**同块里有一份真红时，退码不许是 0**。
 * 第一条是负控制：它在旧实现下会绿。
 */
describe("第 2 遍的判决按文件分开（超时不替同块里的真红挡箭）", () => {
  const CHUNK = ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"];
  const TIMEOUT_BODY = "Error: Test timed out in 30000ms.";
  const ASSERT_BODY = "AssertionError: expected 3 to be 4";
  const TIMEOUT = { status: 1, output: TIMEOUT_BODY };
  const REAL_RED = { status: 1, output: ASSERT_BODY };
  const GREEN = { status: 0, output: "Test Files 1 passed" };
  const settledLow = () =>
    Promise.resolve({ settled: true, load: 0.3, waitedMs: 900 });

  /** 带失败文本的 suite —— 分档靠的就是这段文本，空 body 等于「认不出自己」。 */
  const suiteWith = (name: string, failures: number, text: string) =>
    `<testsuite name="${name}" tests="1" failures="${failures}" errors="0" time="0.4">` +
    `<testcase name="t1"><failure message="boom">${text}</failure></testcase>` +
    `</testsuite>`;

  /** 某一遍的 junit 落到账本里该落的那个文件（布局由 `cFileXmlName` 那一侧拥有）。 */
  function writeXml(dir: string, attempt: number, body: string) {
    writeFileSync(
      cFileXmlName(dir, 0, attempt),
      `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests">${body}</testsuites>\n`,
    );
  }

  /** 第 1 遍的读数：`fails` 里点名的那些文件算失败（复跑面由它决定）。 */
  const firstFails = (...fails: string[]) =>
    CHUNK.map((f) =>
      suiteWith(f, fails.includes(f) ? 1 : 0, fails.includes(f) ? "x" : ""),
    ).join("");

  /** 按次序回放结果的假 spawn，同时把每次的清单记下来（补跑发生过没有要看它）。 */
  function scripted(results: { status: number; output: string }[]) {
    const lists: string[][] = [];
    return {
      lists,
      spawn: (_entry: string, args: string[]) => {
        const at = Math.min(lists.length, results.length - 1);
        lists.push(args.filter((a) => String(a).endsWith(".test.ts")));
        return results[at]!;
      },
    };
  }

  it("负控制：一份超时 + 一份真断言红 ⇒ 退 1 并点名那一份（旧实现这里退 0）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-verdict-"));
    try {
      writeXml(dir, 1, firstFails("tests/a.test.ts", "tests/b.test.ts"));
      writeXml(
        dir,
        2,
        suiteWith("tests/a.test.ts", 1, TIMEOUT_BODY) +
          suiteWith("tests/b.test.ts", 1, ASSERT_BODY),
      );
      const { value: code, text } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: () => ({
            status: 1,
            output: `${TIMEOUT_BODY}\n${ASSERT_BODY}`,
          }),
          settle: settledLow,
        }),
      );
      expect(code, "真红被同块里的超时一起降级成「未校验」").toBe(1);
      expect(text).toContain("tests/b.test.ts");
      /* 那句「不是负载假红」必须落在点名之后，读的人才知道该查哪一份。 */
      expect(text).toContain("这不是负载假红");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("每份都只是超时 ⇒ 未校验放行，名单只有那两份（c 第一遍就绿，不在里面）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-verdict-"));
    try {
      writeXml(dir, 1, firstFails("tests/a.test.ts", "tests/b.test.ts"));
      writeXml(
        dir,
        2,
        suiteWith("tests/a.test.ts", 1, TIMEOUT_BODY) +
          suiteWith(
            "tests/b.test.ts",
            1,
            "Timeout waiting for worker to respond",
          ),
      );
      const unverified: string[][] = [];
      const { value: code } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: () => TIMEOUT,
          settle: settledLow,
          onUnverified: (files: string[]) => unverified.push([...files]),
        }),
      );
      expect(code).toBe(0);
      expect(unverified).toEqual([["tests/a.test.ts", "tests/b.test.ts"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("第 2 遍的读数认不出自己 ⇒ 逐文件补跑；补跑是断言红就退 1", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-verdict-"));
    try {
      writeXml(dir, 1, firstFails("tests/a.test.ts"));
      /* 没有第 2 遍的 junit（拿不到 / 形状不认识）⇒ 只能一份一次跑。 */
      const s = scripted([TIMEOUT, TIMEOUT, REAL_RED]);
      const { value: code } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: s.spawn,
          settle: settledLow,
        }),
      );
      expect(s.lists).toHaveLength(3);
      expect(s.lists[2]).toEqual(["tests/a.test.ts"]);
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("补跑里自己通过的那一份，不许留在「未校验」名单里", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-verdict-"));
    try {
      writeXml(dir, 1, firstFails("tests/a.test.ts", "tests/b.test.ts"));
      const s = scripted([TIMEOUT, TIMEOUT, GREEN, TIMEOUT]);
      const unverified: string[][] = [];
      const { value: code } = await captureStderr(() =>
        runChunk(CHUNK, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: s.spawn,
          settle: settledLow,
          onUnverified: (files: string[]) => unverified.push([...files]),
        }),
      );
      expect(code).toBe(0);
      /* a 补跑就绿了：它既不是超时也不是真红，点名它就是谎报覆盖面。 */
      expect(unverified).toEqual([["tests/b.test.ts"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("认不出的份数超过补跑上限 ⇒ 退 2：不是绿也不是红，且不冒充「整块只是超时」", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "c-verdict-"));
    const nine = Array.from(
      { length: 9 },
      (_unused, i) => `tests/n${i}.test.ts`,
    );
    try {
      writeXml(dir, 1, nine.map((f) => suiteWith(f, 1, "x")).join(""));
      const s = scripted([TIMEOUT, TIMEOUT]);
      const { value: code, text } = await captureStderr(() =>
        runChunk(nine, {
          entry: "vitest.mjs",
          junitDir: dir,
          chunkId: 0,
          spawn: s.spawn,
          settle: settledLow,
        }),
      );
      expect(code).toBe(2);
      expect(text).toContain("分不出");
      /* 超过上限就停：不再花 9 次进程启动去换那份读数。 */
      expect(s.lists).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("分档的纯函数侧：三种结论互不合并，读不出来的那份归 unknown", () => {
    const read = [
      { name: "tests/a.test.ts", body: TIMEOUT_BODY },
      { name: "tests/b.test.ts", body: ASSERT_BODY },
    ];
    const both = classifyRetry({
      files: ["tests/a.test.ts", "tests/b.test.ts"],
      readSuites: read,
    });
    expect(both.kind).toBe("hard-fail");
    expect(both.hardFail).toEqual(["tests/b.test.ts"]);
    expect(
      classifyRetry({
        files: ["tests/a.test.ts", "tests/z.test.ts"],
        readSuites: read,
      }).kind,
    ).toBe("unattributed");
    /* 补跑之后：unknown 被并掉，而补跑绿的那份进 green、不进任何红 / 超时档。 */
    const merged = mergePerFileReads(
      classifyRetry({
        files: ["tests/a.test.ts", "tests/z.test.ts"],
        readSuites: read,
      }),
      [{ file: "tests/z.test.ts", status: 0, output: "" }],
    );
    expect(merged.kind).toBe("unverified");
    expect(merged.green).toEqual(["tests/z.test.ts"]);
    expect(merged.unknown).toEqual([]);
  });

  it("junit 里失败文本读得出来源（形状假设钉住：每个文件一个 testsuite）", () => {
    const suites = failingSuiteTextsFromJunit(
      `<testsuites name="vitest tests">${suiteWith(
        "tests/a.test.ts",
        1,
        ASSERT_BODY,
      )}${suiteWith("tests/c.test.ts", 0, "")}</testsuites>`,
    );
    expect(suites.map((s: { name: string }) => s.name)).toEqual([
      "tests/a.test.ts",
    ]);
    expect(suites[0]!.body).toContain("AssertionError");
  });
});

/* ── 「没跑起来」与「跑起来但红了」必须是两件事 ─────────────────────────────────
 *
 * 现场（平台的 `受影响用例` 一格）：输出里一串 `Error:` 加一段 `AggregateError`，
 * 一条断言都没红，而格子非零退出 —— 于是「这台机器上依赖没装上 / worker 起不来」
 * 被写成「这次改动有回归」。被拦下的人照着那屏去查代码，查的是一件没发生的事。
 *
 * 这一档的**下一动作与真断言红相反**：真红去修代码（一次都不复跑），装载失败去修
 * 环境（复跑没有意义，同样的环境同样的炸）。所以它必须单独成档、退 2（未判定），
 * 而不是退 1。
 */
describe("第 1 遍就没跑起来（装载 / 运行时级错误）", () => {
  const AGGREGATE = {
    status: 1,
    output:
      "Error: Cannot find module 'vitest'\n" +
      "    at Module._resolveFilename (node:internal/modules/cjs/loader:1234:15)\n" +
      "AggregateError: all promises were rejected\n" +
      "    at Function.allSettled (<anonymous>)\n",
  };
  const GREEN = { status: 0, output: "Test Files 2 passed" };
  const CHUNK = ["tests/a.test.ts", "tests/b.test.ts"];

  /** 起一次 `runChunk` 并把 stderr 收在手里（与上面那节同一个抓取通道）。 */
  async function runWith(
    results: { status: number; output: string }[],
    extra: Partial<Parameters<typeof runChunk>[1]> = {},
  ) {
    const calls: string[][] = [];
    const seen: string[] = [];
    const { value: code, text } = await captureStderr(() =>
      runChunk(CHUNK, {
        entry: "vitest.mjs",
        spawn: (_entry: string, args: string[]) => {
          calls.push(args);
          return results[Math.min(calls.length - 1, results.length - 1)]!;
        },
        settle: () =>
          Promise.resolve({ settled: true, load: 0.1, waitedMs: 0 }),
        onAttempt: (r: { outcome: string }) => seen.push(r.outcome),
        ...extra,
      }),
    );
    return { code, text, calls, seen };
  }

  it("指纹认得 AggregateError / 模块找不到 / 原生模块版本不符", () => {
    expect(isLaunchFailureShaped(AGGREGATE.output)).toBe(true);
    expect(isLaunchFailureShaped("Error: Cannot find package 'x'")).toBe(true);
    expect(
      isLaunchFailureShaped(
        "ERR_DLOPEN_FAILED: was compiled against a different Node.js version",
      ),
    ).toBe(true);
    expect(
      isLaunchFailureShaped("No test files found, exiting with code 1"),
    ).toBe(true);
  });

  it("**真断言红优先**：栈里带 AggregateError 的断言失败不许被读成环境问题", () => {
    /* 放行一条真回归比多查一次环境贵得多 —— 所以这一条是「宁可误判成真红」的方向。 */
    expect(
      isLaunchFailureShaped(
        "AssertionError: expected 3 to be 4\nError: AggregateError",
      ),
    ).toBe(false);
  });

  it("装载失败 ⇒ 退 2（未判定，不是红）、一次都不复跑、下一动作指向环境", async () => {
    const { code, text, calls, seen } = await runWith([AGGREGATE, GREEN]);
    expect(code, "把「没跑起来」读成红，就是让提交的人去查一件没发生的事").toBe(
      2,
    );
    expect(calls, "同样的环境再跑一遍没有任何意义").toHaveLength(1);
    expect(seen).toEqual(["launch-failed"]);
    expect(text).toContain("没跑起来");
    expect(text).toContain("pnpm install");
    expect(text).toContain("npm_config_");
    /* 不许把它说成用例红。 */
    expect(text).not.toContain("真红");
  });

  it("收尾的账把「没跑起来」与「复跑」分开念（不许为一次没发生的等待报账）", async () => {
    const { text } = await runWith([AGGREGATE]);
    /* 只跑了一档，没有复跑 ⇒ 那段「等待与复跑账」不该出现（它一块都没复跑）。 */
    expect(text).not.toContain("本次的等待与复跑账");
  });
});

/* ── 日志预算：平台那一格只换 reporter，不动判据 ────────────────────────────────
 *
 * 平台对单次构建日志的硬上限是 102400 字节，超了只留一句 `The log length exceeds the
 * limit(102400)`，且保留的是尾部 —— 被截掉的恰是开头（跑了哪些、哪份失败）。而
 * `vitest run` 的默认 reporter 会**逐个文件**打一行，一跑 100+ 行是常态。
 */
describe("日志预算：quiet 档只换 reporter", () => {
  it("没置 ⇒ 一个字都不加（本地人跑时要看逐文件清单）", () => {
    expect(resolveQuiet(undefined)).toEqual({ quiet: false, note: null });
    expect(resolveQuiet("")).toEqual({ quiet: false, note: null });
    expect(reporterArgs(false)).toEqual([]);
  });

  it("置 1 ⇒ dot（每行几十个点，失败明细与原文照样打）", () => {
    expect(resolveQuiet("1").quiet).toBe(true);
    expect(reporterArgs(true)).toEqual(["--reporter=dot"]);
  });

  it("「quiet 了没有」必须在日志里读得回来（它没生效的表现是「日志又超长」）", () => {
    /* 这一档没生效时**不报错**：表现是平台日志又被截断，而那时读的人只会看到
     * `The log length exceeds the limit` —— 正是这一档要治的病。所以「用的哪个
     * reporter」必须是一句读得到的话，不能只存在于代码里（§11.23）。 */
    const said: string[] = [];
    expect(announceQuiet("1", (t) => said.push(t))).toBe(true);
    expect(said.join("")).toContain("dot");
    const off: string[] = [];
    expect(announceQuiet(undefined, (t) => off.push(t))).toBe(false);
    expect(off.join("")).toContain("默认");
    /* 两档的话术必须**读得出区别**（否则这一格在日志里等于没有）。 */
    expect(said.join("")).not.toContain("默认");
    expect(off.join("")).not.toContain("dot");
  });

  it("非法值按不 quiet 办并提醒（不静默降级）", () => {
    for (const raw of ["0", "true", "yes"]) {
      const r = resolveQuiet(raw);
      expect(r.quiet, `${raw} 不该被读成 quiet`).toBe(false);
      expect(r.note).toContain("只换 reporter");
    }
  });

  it("quiet 真的接进了**两遍**（复跑那一遍的打印量更大）", async () => {
    const TIMEOUT = { status: 1, output: "Error: Test timed out in 30000ms." };
    const GREEN = { status: 0, output: "Test Files 1 passed" };
    const calls: string[][] = [];
    await captureStderr(() =>
      runChunk(["tests/a.test.ts"], {
        entry: "vitest.mjs",
        quiet: true,
        spawn: (_e: string, args: string[]) => {
          calls.push(args);
          return calls.length === 1 ? TIMEOUT : GREEN;
        },
        settle: () =>
          Promise.resolve({ settled: true, load: 0.1, waitedMs: 0 }),
      }),
    );
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      expect(args).toContain("--reporter=dot");
    }
  });
});

/**
 * 墙钟判点自己那一份（纯函数层，ISSUE #2364）。
 *
 * 为什么这些不进上面的判决链用例：判决链那几条测的是**接没接上**（起不起第二遍、
 * 退码哪一档、名单点谁），而这里几条测的是**界划在哪一侧**——后者全是算术，
 * 注入 `startMs` / `nowMs` 就能确定，不需要假进程。
 */
describe("墙钟判点：界划在哪一侧（ISSUE #2364）", () => {
  const MIN = 60_000;

  it("预算必须既盖得住「首遍 + 一遍复跑」，又明显低于平台那一刀", () => {
    /* 两个数都是当场读数，不是风格：首遍 9.2 分钟 + 串行复跑 13.6 分钟 = 22.8 分钟
       （build cnb-q1c-1k5ora37n），平台那一刀落在 3240105ms。界漂到掐点之上时这条
       判点就永远没有机会说话 —— 而那正是本单立的事。 */
    expect(STAGE_WALL_CLOCK_MS).toBeGreaterThanOrEqual(22.8 * MIN);
    expect(STAGE_WALL_CLOCK_MS).toBeLessThan(PLATFORM_STAGE_KILL_MS);
  });

  it("串行复跑按首遍墙钟估，**不**按「失败了几份」的比例估", () => {
    /* 实测反例：第 2 遍只跑 2/98 份，却比首遍更慢（串行去掉了并发优势，1.48 倍）。
     * 按比例算会把界划在错的一侧 —— 它会在最需要复跑的那一次说「跑得完」。 */
    expect(estimateSerialRerunMs(9.2 * MIN)).toBe(9.2 * MIN * SERIAL_RERUN_FACTOR);
    expect(SERIAL_RERUN_FACTOR).toBeGreaterThanOrEqual(1.48);
    expect(estimateSerialRerunMs(-5)).toBe(0);
  });

  it("没设界 ⇒ 照旧全跑，且读数与「还剩很多」可分辨", () => {
    const open = budgetAllows({ estimateMs: 10 * MIN });
    expect(open.ok).toBe(true);
    /* 不许把「没设界」冒充成一个巨大的剩余量：那是两种不同的事实。 */
    expect(open.remainingMs).toBeNull();
    const tight = budgetAllows({
      budget: { deadline: 100 },
      estimateMs: 200,
      nowMs: 0,
    });
    expect(tight.ok).toBe(false);
    expect(tight.remainingMs).toBe(100);
  });

  it("逐文件补跑的份数：没界=全部，界已过=0，没单价=先拿一份的单价", () => {
    expect(
      affordablePerFileCount({ perFileMs: 3_000, pending: 5 }),
    ).toBe(5);
    expect(
      affordablePerFileCount({
        budget: { deadline: 10_000 },
        perFileMs: 3_000,
        pending: 5,
        nowMs: 10_000,
      }),
    ).toBe(0);
    expect(
      affordablePerFileCount({
        budget: { deadline: 100_000 },
        perFileMs: 0,
        pending: 5,
        nowMs: 0,
      }),
    ).toBe(1);
    expect(
      affordablePerFileCount({
        budget: { deadline: 100_000 },
        perFileMs: 30_000,
        pending: 5,
        nowMs: 0,
      }),
    ).toBe(3);
  });

  it("两句判点话术各自必须说完「界是多少 / 为什么停 / 下一动作」", () => {
    const second = wallClockSkipReport({
      remainingMs: 3 * MIN,
      estimateMs: 18.4 * MIN,
      files: ["tests/a.test.ts"],
    });
    /* 「未判定」与「未校验」不许同形 —— 混了就等于给静默通过开门。 */
    expect(second).toContain("未判定");
    expect(second).toContain("--no-file-parallelism");
    expect(second).not.toContain("已确认");
    const perFile = perFileBudgetStopReport({
      remainingMs: 1_200,
      perFileMs: 4_000,
      left: 2,
    });
    expect(perFile).toContain("一次都没被测量过");
    expect(perFile).toContain("剩下 2 份");
  });

  it("界可以按现场调（只调资源），非法值落默认并说出口，不退成 0", () => {
    /* 没有这个口子，「界落下并说出未判定」就只能靠注入假时钟的用例证明，
     * 生产入口自己永远拿不到那次读数。 */
    expect(resolveWallClockMs("60000")).toEqual({
      budgetMs: 60_000,
      note: null,
    });
    expect(resolveWallClockMs(undefined).budgetMs).toBe(STAGE_WALL_CLOCK_MS);
    expect(resolveWallClockMs("").budgetMs).toBe(STAGE_WALL_CLOCK_MS);
    for (const bad of ["0", "-1", "abc", "12.5"]) {
      const got = resolveWallClockMs(bad);
      expect(got.budgetMs, `非法值 ${bad} 不许退成 0`).toBe(STAGE_WALL_CLOCK_MS);
      expect(got.note, `非法值 ${bad} 必须说出口`).toContain("正整数毫秒");
    }
  });

  it("起界那份给的是「整次一份」的截止时刻，不是每块一份", () => {
    const b = wallClockBudget({ startMs: 1_000, budgetMs: STAGE_WALL_CLOCK_MS });
    expect(b.deadline).toBe(1_000 + STAGE_WALL_CLOCK_MS);
    expect(b.budgetMs).toBe(STAGE_WALL_CLOCK_MS);
  });
});
