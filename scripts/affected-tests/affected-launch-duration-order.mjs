#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * affected-launch-duration-order.mjs — 「重块排前」的耗时台账（ISSUE #2863 的 ③）。
 *
 * 为什么需要它：分块（FIXED_CHUNK_FILES，#2863）把固定段切成 5 块后，**块的顺序**成了
 * makespan 的一部分 —— 247s 的重文件如果排在最后一块开跑，整段墙钟就被它钉死。而
 * 「按文件体积排」被实测否决：eslint-gate-canary 只有 5KB（体积排名 254/306），耗时却
 * 排第 2（238.5s）—— 重用例的代价在它们 spawn 的工具链，不在源文件大小。所以排序依据
 * 只能是**实测耗时**，来源就是这格本来就在写的 junit（`collectFileTimings` 那一份）。
 *
 * 形态：**提交入库的 JSON 台账**（ratchet baseline 同款）。为什么入库而不是机器本地的
 * `.git` 账：平台侧每次都是全新 clone（`.git` 账永远冷），入库才在 CI 上活；为什么容忍
 * 陈旧：排序是启发式不是判决 —— 台账过期的代价只是「排的不是最优顺序」，不是任何一条
 * 断言红，所以它**不进** `.gate-thresholds.json`（那本账记的是承重数值，这里没有阈值）。
 *
 * ── 量纲：junit 的 `time` 不是「这一份自己的成本」（ISSUE #3030）───────────────
 *
 * vitest 写进 junit 的 `time` 是**该文件在那一次运行里的墙钟**：`--maxWorkers=2` 时
 * 几份同时在跑，同一份的读数随同块里还有谁、机器有多忙一起漂。原先把这一个数原样当
 * 「单份成本」写进台账，于是台账记的是**平台某一次的负载状态**，而它的唯一消费者是
 * 「重块排前」的排序 —— 排序判据反了，而失效形态是静默的（没有任何判据会说「这份
 * 排错了」）。实测同一批文件：
 *
 * | 文件 | 批跑入账（`--maxWorkers=2`） | 隔离单跑（`--no-file-parallelism`） |
 * | -- | -- | -- |
 * | `tests/check-commit-claims.test.ts` | 169.1s | **1.8s** |
 * | `tests/gate-executors.test.ts` | 48.1s | **2.7s** |
 * | `tests/a11y-rules-gate.test.ts` | 35.1s | **4.0s** |
 *
 * 那个 169.1s 在整段里排第三，而实测它是最便宜的一份之一 —— 排前的判据整个反了。
 * 所以台账的键分成两种**来源**，排序只信自带量纲的那一种：
 *
 *   · `isolated` —— 隔离单跑（`--no-file-parallelism <file>`），读的就是「这一份要多久」；
 *   · `batch` —— 批跑墙钟，只留「已知 vs 未知」这一位（排在所有 `isolated` 之后、彼此并列）：
 *     拿它当成本比较就会把便宜的文件供到前面去，而换成一个「更大的常数」也是同一个错
 *     —— 那仍然是拿一个凭空的数去和实测值比（`BATCH_SORT_TIER` 的注释记着这次推翻）。
 *
 * 两种都缺时按原序（「不知道」不构成排序理由）。
 *
 * 更新：`run-affected-tests.mjs --update-timing` 在收尾把本跑的读数并进台账
 * （人为跑，与 ratchet 的 `--update` 同一姿势；CI 不自动写 —— 平台工作区的改动进不了库）。
 * 它记的是 `batch` 来源 —— 要 `isolated` 那一档得跑 `--update-timing --isolated`。
 */

import fs from "node:fs";
import path from "node:path";

/** 台账的落点（入库；与 ratchet baseline 同目录同形态）。 */
export const TIMING_LEDGER_REL = "scripts/.test-file-timing.json";

/**
 * 台账读数的两种来源（ISSUE #3030，量纲见文件头）。
 *
 * `isolated` 是「这一份自己要多久」，可以直接当成本比；`batch` 是「那次并行运行里这份
 * 的墙钟」，随同块里还有谁而漂 —— 只给上界用，**不**参与成本比较。
 */
export const TIMING_SOURCES = /** @type {const} */ (["isolated", "batch"]);

/**
 * `batch` 那一档在排序里的档位 —— **比任何 `isolated` 都低**。
 *
 * 为什么不取一个「明显更大的数」（第一版就是那么写的，被本单自己的用例当场推翻）：
 * 取上界常数是拿**另一个**凭空的数去和实测值比，于是「批跑的 169.1s」照样压过「单跑的
 * 8.3s」—— 判据反了的那个形态只是换了个方向回来。所以这一档不是数值，是**不可比**：
 *
 *   · 块里排前只需要一样东西 —— 「这份已知很重，先开它」；
 *   · 而「已知」这件事只有 `isolated` 说得出来（它是「这一份自己要多久」的实测）。
 *
 * `batch` 读数里混着「同块里还有谁在跑」，它的唯一安全用法是「已知 vs 未知」这一位，
 * 所以整档排到 `isolated` 之后、且彼此并列（不假装知道谁更重）。
 */
export const BATCH_SORT_TIER = -1;

/**
 * 一条台账读数在排序里的**档位**，而不是权重 —— 两档之间不可比是本单的全部修理。
 *
 * `isolated` 给实测值（可以互相比较），`batch` 给 `BATCH_SORT_TIER`（比任何实测都低、
 * 彼此相等）。调用点先按档位降序、档位相同保持原序，所以「不知道谁更重」不会被排成一个序。
 *
 * @param {{ms: number, source: "isolated" | "batch"}} entry
 * @returns {number}
 */
export function sortTier(entry) {
  return entry.source === "isolated" ? entry.ms : BATCH_SORT_TIER;
}

/**
 * 读台账；文件不在 / 坏 JSON ⇒ 回空 Map（排序退化为保持原序 —— 冷启动形态，不是错误）。
 *
 * 两种入库形状都认，因为台账是**入库文件**、改形状的那一刻老版本还在被读：
 *
 *   · 新形状 `{ "tests/x.test.ts": { ms, source } }` —— 自带量纲；
 *   · 老形状 `{ "tests/x.test.ts": 169100 }` —— 裸数字，**来源未知**，按 `batch` 记
 *     （它是 `--update-timing` 从 junit 抄来的那一批，量纲就是批跑墙钟）。
 *
 * 把老形状默认成 `isolated` 会让这一单的修理在改形状的那一刻失效 —— 而失效形态与
 * 改之前一模一样（静默把便宜的文件供到前面）。
 *
 * @param {string} root 仓库根
 * @returns {Map<string, {ms: number, source: "isolated" | "batch"}>}
 */
export function readTimingLedger(root) {
  const out = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, TIMING_LEDGER_REL), "utf8"));
    for (const [name, value] of Object.entries(raw.files ?? {})) {
      if (typeof name !== "string" || name === "") {
        continue;
      }
      const entry =
        typeof value === "object" && value !== null
          ? { ms: Number(value.ms), source: value.source }
          : { ms: Number(value), source: "batch" };
      const okSource = entry.source === "isolated" || entry.source === "batch";
      if (Number.isFinite(entry.ms) && entry.ms >= 0 && okSource) {
        out.set(name, { ms: entry.ms, source: entry.source });
      }
    }
  } catch {
    // 冷启动形态：没有台账就按原序跑。不是「读不出来」，是这一档还没有数据。
  }
  return out;
}

/**
 * 按台账把文件**降序**排（已知耗时的在前、按毫秒降；没入账的保持原相对顺序垫后）。
 * 纯函数：不改输入。排序的目的是 makespan —— 长任务先开跑，尾巴才不会被一个 247s
 * 的文件钉死（长尾理论在 maxWorkers=2 的两路并行上尤其明显）。
 *
 * 档位走 `sortTier()` —— `batch` 那一档全部落在 `BATCH_SORT_TIER` 上（比任何实测都低、
 * 彼此并列，`Array.prototype.sort` 在 V8 上稳定 ⇒ 它们之间保持原序），`isolated` 之间
 * 照实测值排。两档之间比的是**档位**，不是那两个数。
 *
 * @param {string[]} files 计划期的清单（段裁过的）
 * @param {Map<string, {ms: number, source: "isolated" | "batch"}>} ledger `readTimingLedger()` 的产出
 * @returns {string[]}
 */
export function orderByKnownDuration(files, ledger) {
  const known = [];
  const unknown = [];
  for (const f of files) {
    (ledger.has(f) ? known : unknown).push(f);
  }
  known.sort((a, b) => {
    const ea = ledger.get(a);
    const eb = ledger.get(b);
    return (eb ? sortTier(eb) : 0) - (ea ? sortTier(ea) : 0);
  });
  return [...known, ...unknown];
}

/**
 * 把一次跑的逐份用时并进台账并落盘（`--update-timing` 的执行体）。
 *
 * 合并口径：新读数**覆盖**同名旧值（最新的实测最接近当下），台账里没有的键新增；
 * 本跑没跑到的文件**保留**（它们的旧耗时仍是有效的排序依据，删掉只会让排序变瞎）。
 *
 * ⚠️ 覆盖是**按来源**的（ISSUE #3030）：拿一笔 `batch` 读数盖掉一条 `isolated` 记录，
 * 等于把「这一份要多久」换成「那一次并行里它旁边还有谁」—— 量纲被悄悄换掉，而排序照旧
 * 在读它。所以一条读数只覆盖**同来源**的旧值，跨来源取「谁的量纲更强」（`isolated` 胜）；
 * 被拒的那一次要能被回读（返回值里带 `rejected`），不许静默。
 *
 * @param {string} root 仓库根
 * `readings` 是 junit 解析的**运行时**产物：脏读数（缺 name、ms 是 NaN / 负数）会真的出现
 * —— 所以形参按「可缺」声明，下面的过滤就是为它们写的，不是多余条件。
 * `readings` 本身也可能为空 / 缺失（`--update-timing` 拿到空 junit）。
 * @param {Array<{name?: string, ms?: number, source?: "isolated" | "batch"} | null | undefined> | null | undefined} readings 逐份用时（`source` 缺省按 `batch`）
 * @returns {{written: boolean, rejected: string[]}} `written` = 是否落了盘（读数为空 / 写失败 ⇒ false，
 *   调用方照旧收尾，不阻断）；`rejected` = 因量纲更弱而没覆盖的那几份（给日志点名）
 */
export function mergeTimingLedger(root, readings) {
  const usable = (readings ?? []).filter(
    (r) => r?.name && Number.isFinite(r.ms) && Number(r.ms) >= 0,
  );
  if (usable.length === 0) {
    return { written: false, rejected: [] };
  }
  /** @type {Record<string, {ms: number, source: "isolated" | "batch"}>} */
  const files = {};
  const existing = readTimingLedger(root);
  for (const [name, entry] of existing) {
    files[name] = entry;
  }
  const rejected = [];
  for (const r of usable) {
    const source = r.source === "isolated" ? "isolated" : "batch";
    const prior = existing.get(r.name);
    /* `isolated` 是更强的那一档：一笔批跑读数不许把它盖掉（见上方 ⚠️）。 */
    if (prior?.source === "isolated" && source === "batch") {
      rejected.push(r.name);
      continue;
    }
    files[r.name] = { ms: Math.round(r.ms), source };
  }
  try {
    fs.writeFileSync(
      path.join(root, TIMING_LEDGER_REL),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`,
      "utf8",
    );
    return { written: true, rejected };
  } catch {
    return { written: false, rejected };
  }
}
