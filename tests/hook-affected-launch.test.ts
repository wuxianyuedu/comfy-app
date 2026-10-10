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
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_WORKERS,
  isTimeoutShaped,
  loadPerCore,
  planLaunches,
  resolveMaxWorkers,
  resolveVitestEntry,
  runChunk,
  SAFE_ARGV_BUDGET,
  waitForLoadToSettle as waitForLoadToSettleRaw,
} from "../scripts/run-affected-tests.mjs";

/* `run-affected-tests.mjs` 是 `.mjs` + `@ts-nocheck`（提交门槛脚本，tsc 面在 `src/**`），
 * 所以 import 出来的每一个符号在类型层都是 `any` —— 直接 `await` 会撞
 * `@typescript-eslint/await-thenable`（「await 一个非 Promise」）。这里按它 JSDoc 里
 * 已经写明的契约把**用到的那个**收成有类型的别名，其余符号照旧用。 */
const waitForLoadToSettle = waitForLoadToSettleRaw as unknown as (options?: {
  budgetMs?: number;
  pollMs?: number;
  probe?: { loadavg: () => number[]; cpus: () => unknown[] };
  sleepFn?: (ms: number) => void | Promise<void>;
  now?: () => number;
}) => Promise<{ load: number; waitedMs: number; settled: boolean }>;

const HOOK_PATH = ".githooks/pre-commit";
const LAUNCHER_PATH = "scripts/run-affected-tests.mjs";

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
  const block = /run_group C\s+"[^"]*"\s+sh\s+-c\s+'([\s\S]*?)'/.exec(hookText);
  const raw = block?.[1];
  if (raw === undefined) return "";
  return raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();
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

  it("指纹清单与 base-check.mjs 逐条同源（漂移 = 同一件事两个判别式）", () => {
    /* 两份清单是同一件事（「这个红首先是一个负载读数」）在两个执行者上的落地：
     * `base-check` 用它归第五态，启动器用它决定复不复跑。只抄一份正则集合、
     * 而不是从 `base-check.mjs` import —— `base-check` 是 ESM 且带 CLI 入口，
     * 钩子这一层不该为了一个正则常量去背它的整条依赖链；同源的代价是这一条断言。 */
    const baseCheck = readFileSync("scripts/base-check.mjs", "utf8");
    const pick = (text: string): string[] => {
      const block = /const TIMEOUT_SIGNATURES = \[([\s\S]*?)\n\];/.exec(text);
      return (block?.[1] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("/"))
        .map((line) => line.replace(/,$/, ""));
    };
    const mine = pick(src);
    const theirs = pick(baseCheck);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine).toEqual(theirs);
  });

  it("复跑只能更隔离：串行旗标在场，且没有任何抬预算的形态", () => {
    expect(src).toContain('"--no-file-parallelism"');
    // 抬预算那一侧的反向判据（这一档的主要敌人，见 §11.13 / §13.6.4）。
    expect(src).not.toMatch(/testTimeout\s*[:=]\s*\d/);
    expect(src).not.toMatch(/hookTimeout\s*[:=]\s*\d/);
    /* 判的是「**传给 vitest 的 argv 里**并发只许一处」—— 复跑档不许另起一个更大的
     * `--maxWorkers`。所以按 `spawn(` / `spawnSync(` 的实参行数，而不是整份文本里
     * 出现过几次这个字符串：
     *   · 注释 / 文件头说明里的形态不算（那里本来就有）；
     *   · 日志话术（`resolveMaxWorkers` 的 `note`）里的同名字符串也不算 ——
     *     它是给人看的一行提醒，不是并发旋钮，把它算进来会让这条判据变成
     *     「谁在提示语里提到并发谁就红」，而真正的退化（复跑另给一个更大的并发）
     *     照样能从 argv 那一行看出来。
     * 「只许一处」本身不放松：argv 那一行仍是全文件唯一一处。 */
    const workerArgvLines = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => /spawn(Sync)?\(/.test(line))
      .filter((line) => line.includes("--maxWorkers="));
    expect(
      workerArgvLines,
      `传进 vitest 的并发只该有一处（复跑必须更隔离，不许在这个方向上调）：${workerArgvLines.join(" | ")}`,
    ).toHaveLength(1);
    // 接线到 `resolveMaxWorkers` 的解析结果（首跑的并发由它决定）。
    expect(workerArgvLines[0]).toContain("${workers}");
    // 复跑那一次必须**不含**任何并发旗标（只加隔离，不给旋钮）。
    const retryLine = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .find((line) => /spawn(Sync)?\(/.test(line) && line.includes("--no-file-parallelism"));
    expect(retryLine, "复跑那一行还在吗？").toBeTruthy();
    expect(retryLine).not.toContain("--maxWorkers");
  });

  it("触发面：不带指纹时**先于复跑**返回（真断言红一次都不复跑）", () => {
    /* 只切 `runChunk` 里「拿指纹做判断 → 复跑」那一小段：整段数会把上面那条提示
     * 话术一起圈进来，而那句话术里也写着同一个旗标名 —— 于是「复跑被摘掉」
     * 与「只剩日志文字」长得一样。
     * 整条链的**行为**由下一节用注入的假 spawn 整个跑一遍（两向都断退出码），
     * 这里只补一条形状：指纹判在复跑**之前**。 */
    const chunkFn = /export async function runChunk\([\s\S]*?\n\}/.exec(src)?.[0];
    expect(chunkFn, "runChunk 还在吗？").toBeTruthy();
    const guard = chunkFn?.indexOf("if (!isTimeoutShaped(res.output))") ?? -1;
    const retry = chunkFn?.indexOf(`"--no-file-parallelism"`) ?? -1;
    expect(guard).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(-1);
    expect(guard, "指纹判断必须在复跑之前").toBeLessThan(retry);
    // 不带指纹那一支必须**返回非零**（不许静默继续）。
    const earlyReturn = /if \(!isTimeoutShaped\(res\.output\)\) \{[\s\S]*?return res\.status \?\? 1;/.exec(
      chunkFn ?? "",
    );
    expect(earlyReturn, "不带指纹时应当直接阻断").toBeTruthy();
  });

  it("输出被抓在手里再原样回吐 —— 不抓就分不出「真断言红」与「机器太满」", () => {
    // 判决依赖输出内容，所以失败那一档不能再是 stdio:"inherit"。
    const spawn = /function spawnVitest\(entry, args\) \{[\s\S]*?\n\}/.exec(src)?.[0];
    expect(spawn, "spawnVitest 还在吗？").toBeTruthy();
    expect(spawn).toContain("encoding: \"utf8\"");
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
    const res = await waitForLoadToSettle({
      probe: { loadavg: () => [1, 0, 0], cpus: cores(8) },
      sleepFn: () => {
        slept += 1;
      },
    });
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
    const res = await waitForLoadToSettle({
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
    });
    expect(sleeps).toHaveLength(2);
    expect(reads).toEqual([40, 30, 2]);
    expect(res).toMatchObject({ settled: true });
  });

  it("等不到 ⇒ `settled: false`（**不放行**：调用方据此按真红上报）", async () => {
    let ticks = 0;
    const res = await waitForLoadToSettle({
      budgetMs: 3,
      pollMs: 1,
      // 假时钟每跳推进 1ms ⇒ 必然越过 3ms 预算而负载一直很高。
      now: () => ticks,
      sleepFn: () => {
        ticks += 1;
      },
      probe: { loadavg: () => [80, 0, 0], cpus: cores(8) },
    });
    expect(res).toMatchObject({ settled: false });
  });

  it("启动器真的接了这一步（不是写了一把没人调用的等待）", () => {
    const code = readFileSync(LAUNCHER_PATH, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // 默认档就是真等待 —— 注入只在用例里发生，生产路径必须接上。
    expect(code).toMatch(/const settle = deps\.settle \?\? \(\(\) => waitForLoadToSettle\(\)\)/);
    expect(code).toMatch(/const settled = await settle\(\);/);
    // 等不到那一支：必须先 `return`（非零），不许静默 `continue`。
    const unsettled = /if \(!settled\.settled\) \{[\s\S]*?\n  \}/.exec(code)?.[0];
    expect(unsettled, "等不到负载回落的那一支还在吗？").toBeTruthy();
    expect(unsettled).toMatch(/return retry\.status \?\? 1;/);
    expect(unsettled).not.toMatch(/continue;/);
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
    output: "Error: Test timed out in 30000ms.\nIf this is a long-running test...",
  };
  const REAL_RED: SpawnResult = {
    status: 1,
    output: "AssertionError: expected 3 to be 4",
  };
  const GREEN: SpawnResult = { status: 0, output: "Test Files 2 passed" };

  const settledLow = () => Promise.resolve({ settled: true, load: 0.2, waitedMs: 0 });
  const unsettledHigh = () =>
    Promise.resolve({ settled: false, load: 9.5, waitedMs: 300_000 });

  it("超时 + 隔离复跑绿 ⇒ **通过**（这就是「无论负载如何都能提交」那一半）", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, GREEN]);
    const code = await runChunk(CHUNK, {
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
    const code = await runChunk(CHUNK, {
      entry: "vitest.mjs",
      spawn,
      settle: settledLow,
    });
    expect(code).toBe(1);
    expect(calls, "不带超时指纹时不该有第二次调用").toHaveLength(1);
  });

  it("超时 + 隔离复跑**仍红**、负载已回落 ⇒ 阻断（真挂死 / 真回归）", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, REAL_RED]);
    const code = await runChunk(CHUNK, {
      entry: "vitest.mjs",
      spawn,
      settle: settledLow,
    });
    expect(code).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("超时 + 隔离复跑仍红、负载**没回落** ⇒ 仍然阻断（不是绿，只是归不到代码上）", async () => {
    const { spawn } = fakeSpawn([TIMEOUT, TIMEOUT]);
    const code = await runChunk(CHUNK, {
      entry: "vitest.mjs",
      spawn,
      settle: unsettledHigh,
    });
    expect(code).toBe(1);
  });

  it("第一遍就绿 ⇒ 只调一次，且不等、不复跑", async () => {
    const { spawn, calls } = fakeSpawn([GREEN]);
    let settledCalls = 0;
    const code = await runChunk(CHUNK, {
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

  it("复跑**最多一次**：串行红之后不再起第三次", async () => {
    const { spawn, calls } = fakeSpawn([TIMEOUT, TIMEOUT, GREEN]);
    await runChunk(CHUNK, { entry: "vitest.mjs", spawn, settle: settledLow });
    expect(calls).toHaveLength(2);
  });
});

describe("钩子档并发：默认 4，且有一个只调并发、不碰判据的显式覆盖口", () => {
  it("默认档是 4（缺省 / 空串都落到它，且不带任何提醒）", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(resolveMaxWorkers(raw)).toEqual({
        workers: DEFAULT_MAX_WORKERS,
        note: null,
      });
    }
    expect(DEFAULT_MAX_WORKERS).toBe(4);
  });

  it("环境变量由调用点读入（纯函数不兜底 process.env）", () => {
    /* 这一格防的是「用例进程自己继承到的环境变量把默认档那一格污染掉」——
       解析器一旦自己兜底 `process.env`，本文件在 `COMFY_PRECOMMIT_MAX_WORKERS=2`
       下跑时「不给值＝默认 4」会假红，而那种失效长的样子是「判据真的坏了」。 */
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toMatch(
      /resolveMaxWorkers\(\s*\n?\s*process\.env\.COMFY_PRECOMMIT_MAX_WORKERS/,
    );
    // 函数体里不许再出现一次 process.env（那会让它不再纯）。
    const body = /export function resolveMaxWorkers\(([\s\S]*?)\n\}/.exec(src);
    expect(body, "解不出 resolveMaxWorkers 的函数体").not.toBeNull();
    expect(body![1]).not.toContain("process.env");
  });

  it("显式覆盖生效，且提醒里说清「只调并发」", () => {
    const r = resolveMaxWorkers("1");
    expect(r.workers).toBe(1);
    expect(r.note).toContain("只调并发");
    // 覆盖成默认值本身不提醒：说了等于没说。
    expect(resolveMaxWorkers(String(DEFAULT_MAX_WORKERS)).note).toBeNull();
  });

  it("非法值按默认办并提醒 —— 不许静默降级成 0（那会让 vitest 报错指不到真因）", () => {
    for (const raw of ["0", "-2", "abc", "2.5", "NaN"]) {
      const r = resolveMaxWorkers(raw);
      expect(r.workers, `${raw} 应落回默认`).toBe(DEFAULT_MAX_WORKERS);
      expect(r.note, `${raw} 应有一条提醒`).toContain("不是 ≥1 的整数");
    }
  });

  it("覆盖值真的进了 vitest 的命令行（不是只解析不接线）", () => {
    const src = readFileSync(LAUNCHER_PATH, "utf8");
    expect(src).toMatch(/--maxWorkers=\$\{workers\}/);
    expect(src).not.toMatch(/--maxWorkers=\$\{MAX_WORKERS\}/);
  });
});
