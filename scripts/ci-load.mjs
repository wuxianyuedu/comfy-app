#!/usr/bin/env node
/**
 * ci-load.mjs — 「这一跑该开几个并发」的**唯一出处**（规范 §13.5.21）。
 *
 * 为什么要有这一件：`单元测试` 与 `生产构建` 是这条流水线上唯一两档会自己起一堆
 * 子进程的 stage，而它们的并发在此之前**写死在注释里**（`--maxWorkers=4` 那一段
 * 说「宿主机 16 逻辑核」）。于是「这台机现在能不能扛」与配置里那个常数**没有任何
 * 联系** —— 节点换了、或者同一台机上多了第二条流水线（自托管节点从不限制并发数），
 * 配置照旧按 8 核铺开，现场形态是「既不推进也不报错」（`cnb-jt3-1k5071kou` 的
 * ESLint 挂 8640s 就是这么来的）。
 *
 * ── 先说清楚「runner 配置能不能控负载」的边界 ─────────────────────────
 *
 *   · **`runner.cpus` 在自托管上无效**：官方文档（build-node.html「限制」）原文
 *     「自定义 Runner 默认不开启 Docker 能力，构建脚本直接运行在宿主机上，因此
 *     `runner.cpus` 配置无效」。本仓 `.cnb.yml` 因此**刻意不声明**它 —— 写上去只会
 *     让人以为核数被控住了。
 *   · **并发数平台不给旋钮**：同一台机上挂几个 runner、每次同时跑几条流水线，
 *     都不在 `.cnb.yml` 的声明面里。`lock.cancel-in-progress` 只能掐掉**同一个 key**
 *     上的旧跑（本仓按 PR 分锁，见 §13.5.3.10），不同 PR 之间仍然会叠加。
 *
 * 所以仓库能做的不是「给平台一个负载上限」，而是**让每一档按现场核数自己收敛**：
 * 核数从环境（`CNB_CPUS`）与 `os.availableParallelism()` 里读，读不到才退默认值。
 * 这是「按事实降载」，不是「放宽判据」—— 用例、预算、覆盖率阈值一个字不动。
 *
 * ── 什么**不**在这里算 ────────────────────────────────────────────────
 *
 * `生产构建` 用的是 `next build` 自己的并发（Webpack/Turbopack worker 数），它没有
 * 一个「按核数收敛」的键；给 `NODE_OPTIONS=--max-old-space-size` 之类的旋钮改的是
 * 内存上限，不是并发 —— 那属于「换一个东西冒充」，本条刻意不做。本件只服务
 * **vitest 的 `--maxWorkers`**，第二个消费者出现时再扩，不预先造旋钮。
 */
import os from "node:os";

/**
 * 「一个 worker 至少要几核」—— 4 是实测值（规范 §13.5.3.8）：
 * 16 逻辑核上 `--coverage` 让每份文件多一层插桩（同两文件 6.2s → 9.2s，+50% CPU），
 * 而套件里大量用例**真起子进程**（git / node / prettier / PowerShell），超订的那一份
 * 直接从「等 CPU」变成「等子进程」，表现是 `Test timed out in 30000ms`。
 */
export const CORES_PER_WORKER = 4;

/** 平台池与自托管都不给读数时的兜底（等于按 16 逻辑核这一档算）。 */
export const FALLBACK_CORES = 16;

/** 最少 1 个 worker（0 会让 vitest 用一个与真因无关的错收场）。 */
export const MIN_WORKERS = 1;

/**
 * 从环境里读「这台机有几个逻辑核」。
 *
 * 顺序有理由：`CNB_CPUS` 是**平台给的读数**，它比 `os.availableParallelism()` 更贴近
 * 「这一趟分到多少」—— 自托管节点上两者通常相同，但平台池 / cgroup 限额下前者才是
 * 真的可用量（`availableParallelism` 会照宿主机报）。读不到 / 不是正整数就往后落，
 * **不静默变成 0**（那会让 `planWorkers` 算出一个 0 并用一个怪结论收场）。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{cores: number, source: "CNB_CPUS" | "os" | "fallback", note: string | null}}
 */
export function resolveCores(env = process.env) {
  const raw = String(env.CNB_CPUS ?? "").trim();
  if (raw !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return { cores: parsed, source: "CNB_CPUS", note: null };
    }
    return {
      cores: os.availableParallelism?.() ?? FALLBACK_CORES,
      source: "os",
      note: `CNB_CPUS="${raw}" 不是 ≥1 的整数，改按本机读数办`,
    };
  }
  const local = os.availableParallelism?.();
  if (Number.isInteger(local) && local >= 1) {
    return { cores: local, source: "os", note: null };
  }
  return {
    cores: FALLBACK_CORES,
    source: "fallback",
    note: `读不到核数，按 ${FALLBACK_CORES} 逻辑核这一档办`,
  };
}

/**
 * 核数 → `--maxWorkers`。
 *
 * **不用 `Math.floor(cores / CORES_PER_WORKER)` 的余数去吃零头**：8 核算出 2 是对的，
 * 而 6 核也算 1（floor(1.5)）—— 那一档在实测里是「2 个 worker 才稳」的（§11.13 的
 * 12 核一档给的就是 3）。所以取 `ceil`，宁可多开一个也不把一台 6 核机压成单 worker
 * 跑到墙钟爆掉：**这一档买的是「别把机器压死」，不是「最省 CPU」**。
 *
 * @param {number} cores
 * @returns {number}
 */
export function workersForCores(cores) {
  const n = Number.isFinite(cores) && cores >= 1 ? cores : FALLBACK_CORES;
  return Math.max(MIN_WORKERS, Math.ceil(n / CORES_PER_WORKER));
}

/**
 * 本档要用的 `--maxWorkers`，连「为什么是这个数」一起给出来。
 *
 * `override` 是给**人**的出口（`COMFY_CI_MAX_WORKERS`）：机器被别的东西占着时把并发
 * 压到 1 是唯一还兑现得了的动作（同 `.githooks` 的 `COMFY_PRECOMMIT_MAX_WORKERS`，
 * 那一条只调并发、不碰任何判据）。非法值按默认办并提醒，**不静默降级成 0**。
 *
 * @param {{env?: Record<string, string | undefined>}} [options]
 * @returns {{workers: number, cores: number, source: string, note: string | null}}
 */
export function resolveCiWorkers({ env = process.env } = {}) {
  const { cores, source, note } = resolveCores(env);
  const derived = workersForCores(cores);
  const raw = String(env.COMFY_CI_MAX_WORKERS ?? "").trim();
  if (raw === "") return { workers: derived, cores, source, note };
  const override = Number(raw);
  if (!Number.isInteger(override) || override < MIN_WORKERS) {
    return {
      workers: derived,
      cores,
      source,
      note: `COMFY_CI_MAX_WORKERS="${raw}" 不是 ≥1 的整数，按默认 ${derived} 办`,
    };
  }
  return {
    workers: override,
    cores,
    source,
    note:
      `COMFY_CI_MAX_WORKERS 覆盖：--maxWorkers=${override}` +
      `（按核数应是 ${derived}；这只调并发，不动任何判据）`,
  };
}
