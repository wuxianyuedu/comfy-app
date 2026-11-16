#!/usr/bin/env node
/**
 * wait-for-ship.mjs —— 「等 ship 出终态」的**确定性组件**（ISSUE #4118）。
 *
 * 立案现场：`pnpm ship --mode auto` 在后台终端里跑，执行者想知道「完了没有」。
 * 此前只有两条路，都有病：① 即兴 `sleep 330` 再翻日志（时长靠猜、CI 多打一行
 * banner 行号就截错）；② 手敲 `pnpm ship --result` 轮询（每眼之间睡多久全靠临场
 * 发挥，失败也要睡满同样的觉）。本组件把「等待」固化成**一份实现**：
 *
 *   · **短间隔**：缺省 10s 一眼（`--interval <秒>` 可调）；
 *   · **明确终止条件**：判定只认 `ship --result --json` 那份结构化落盘读数
 *     （`.git/ship-result.json`，原子替换、不会读到半截），**不按输出行号截**；
 *   · **总上限**：缺省 45min（`--timeout <秒>`，与 ship 轮询预算同量级），到点退 4
 *     （「无终态」那一档的语义：没等到 ≠ 通过）；
 *   · **坏消息立即返回**：快照一离开 `running`（red / not-run / interrupted）马上返回，
 *     绝不「只等成功、不等失败」地睡满上限。
 *
 * 「能立即执行就直接执行」：调用时 ship 若已出完终态，**第一眼就返回，一次 sleep
 * 都不发生**；还在跑才进入轮询。命令之间不许再插无意义的 sleep（AGENTS 硬规则 32）。
 *
 * 退码照抄 ship 退码表（`ship-codes.mjs`，唯一出处）：快照收了口的抄 `exitCode`
 * （interrupted 没有退码 ⇒ 2 = 没结论）；等待方自己的超时是 4（CI 无终态）。
 *
 * 用法：
 *   pnpm ship:wait                              # 10s 一眼，总上限 45min
 *   pnpm ship:wait --interval 5 --timeout 900   # 自定义节奏与上限（单位：秒）
 *   pnpm ship:wait --json                       # 末尾把结构化读数也打一份
 */
import path from "node:path";
import process from "node:process";

import { CODE } from "./ship-codes.mjs";
import { formatShipResult, readShipResult } from "./ship-result.mjs";

/** 缺省轮询间隔（毫秒）：10s 一眼，够密又不刷屏。 */
export const DEFAULT_INTERVAL_MS = 10_000;
/** 缺省总上限（毫秒）：45min，与 ship 轮询预算同量级。 */
export const DEFAULT_TIMEOUT_MS = 45 * 60_000;

/**
 * 解析 CLI 参数。只认 `--interval <秒>` / `--timeout <秒>` / `--json`；
 * 形状不对退 2（用法错），不静默收下。
 *
 * @param {string[]} argv
 * @returns {{intervalMs:number, timeoutMs:number, json:boolean, error:string|null}}
 */
export function parseArgs(argv) {
  let intervalMs = DEFAULT_INTERVAL_MS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const take = () => {
      const v = argv[i + 1];
      i += 1;
      return v;
    };
    if (flag === "--json") {
      json = true;
      continue;
    }
    if (flag === "--interval" || flag === "--timeout") {
      const raw = take();
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n <= 0) {
        return {
          intervalMs,
          timeoutMs,
          json,
          error: `\`${flag}\` 要一个正数（秒），收到：${raw ?? "(缺值)"}`,
        };
      }
      if (flag === "--interval") {
        intervalMs = n * 1000;
      } else {
        timeoutMs = n * 1000;
      }
      continue;
    }
    return { intervalMs, timeoutMs, json, error: `认不出的旗标：${flag}` };
  }
  return { intervalMs, timeoutMs, json, error: null };
}

/**
 * 等待本体。**纯轮询落盘读数**：一次也不碰平台、不碰 ship 进程，可被用例把
 * `sleep` / `now` / `resolve` 全部注入后确定性复现。
 *
 * @param {{root?: string, resolve?: (cwd?: string) => string | null,
 *           intervalMs?: number, timeoutMs?: number,
 *           sleep?: (ms: number) => Promise<void>, now?: () => number,
 *           log?: (s: string) => void}} [io]
 * @returns {Promise<{code:number, timedOut:boolean, reading:import("./ship-result.mjs").ShipResultReading}>}
 */
export async function waitForShip(io = {}) {
  const root = io.root ?? process.cwd();
  const intervalMs = io.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = io.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = io.now ?? (() => Date.now());
  const log = io.log ?? (() => {});
  const deadline = now() + timeoutMs;
  /** 上一次见到的阶段数：只在有新进展时念一行，不按固定节奏刷屏。 */
  let seenStages = -1;
  for (;;) {
    const reading = readShipResult(root, io.resolve);
    const r = reading.result;
    /* 终止条件：快照离开 `running`（green / red / not-run / interrupted）。
     * interrupted 没有退码 ⇒ 2（没结论）；其余照抄快照里的 exitCode。 */
    if (reading.found && r && r.status !== "running") {
      return { code: r.exitCode ?? CODE.NOT_RUN, timedOut: false, reading };
    }
    if (now() >= deadline) {
      return { code: CODE.CI_PENDING, timedOut: true, reading };
    }
    const stageCount = r?.stages.length ?? 0;
    if (stageCount !== seenStages) {
      seenStages = stageCount;
      log(
        `[wait-for-ship] 已等 ${Math.round((now() - (deadline - timeoutMs)) / 1000)}s · status=${r?.status ?? "无快照"} · 走到 ${stageCount} 格${r?.status === "running" ? " · 继续等" : ""}`,
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- 轮询的本质是串行等待：读完一眼才睡到下一眼，并行化没有意义
    await sleep(intervalMs);
  }
}

/**
 * CLI 入口：等待 + 念结论。`--json` 在人类可读结论之后补一份结构化读数。
 *
 * @param {{argv?: string[], root?: string, resolve?: (cwd?: string) => string | null,
 *           sleep?: (ms: number) => Promise<void>, now?: () => number,
 *           log?: (s: string) => void}} [io]
 * @returns {Promise<number>}
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const log = io.log ?? ((s) => process.stdout.write(`${s}\n`));
  const parsed = parseArgs(argv);
  if (parsed.error) {
    log(`[wait-for-ship] ${parsed.error} ⇒ 用法错，退 2。`);
    return CODE.NOT_RUN;
  }
  const { code, timedOut, reading } = await waitForShip({ ...io, ...parsed });
  for (const line of formatShipResult(reading)) {
    log(line);
  }
  log(
    timedOut
      ? `[wait-for-ship] ✗ 等到总上限（${Math.round(parsed.timeoutMs / 1000)}s）还没出终态 ⇒ 退 4（无终态 ≠ 通过）。`
      : `[wait-for-ship] ✓ ship 已出终态 ⇒ 退 ${code}。`,
  );
  if (parsed.json) {
    log(JSON.stringify(reading, null, 2));
  }
  return code;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  main().then((code) => {
    process.exit(code);
  });
}
