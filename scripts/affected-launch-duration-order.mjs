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
 * 更新：`run-affected-tests.mjs --update-timing` 在收尾把本跑 junit 的逐份用时并进台账
 * （人为跑，与 ratchet 的 `--update` 同一姿势；CI 不自动写 —— 平台工作区的改动进不了库）。
 */

import fs from "node:fs";
import path from "node:path";

/** 台账的落点（入库；与 ratchet baseline 同目录同形态）。 */
export const TIMING_LEDGER_REL = "scripts/.test-file-timing.json";

/**
 * 读台账；文件不在 / 坏 JSON ⇒ 回空 Map（排序退化为保持原序 —— 冷启动形态，不是错误）。
 *
 * @param {string} root 仓库根
 * @returns {Map<string, number>}
 */
export function readTimingLedger(root) {
  const out = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, TIMING_LEDGER_REL), "utf8"));
    for (const [name, ms] of Object.entries(raw.files ?? {})) {
      const n = Number(ms);
      if (typeof name === "string" && name !== "" && Number.isFinite(n) && n >= 0) {
        out.set(name, n);
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
 * @param {string[]} files 计划期的清单（段裁过的）
 * @param {Map<string, number>} ledger `readTimingLedger()` 的产出
 * @returns {string[]}
 */
export function orderByKnownDuration(files, ledger) {
  const known = [];
  const unknown = [];
  for (const f of files) {
    (ledger.has(f) ? known : unknown).push(f);
  }
  known.sort((a, b) => (ledger.get(b) ?? 0) - (ledger.get(a) ?? 0));
  return [...known, ...unknown];
}

/**
 * 把一次跑的逐份用时并进台账并落盘（`--update-timing` 的执行体）。
 *
 * 合并口径：新读数**覆盖**同名旧值（最新的实测最接近当下），台账里没有的键新增；
 * 本跑没跑到的文件**保留**（它们的旧耗时仍是有效的排序依据，删掉只会让排序变瞎）。
 *
 * @param {string} root 仓库根
 * @param {{name: string, ms: number}[]} readings junit 读回的逐份用时
 * @returns {boolean} 是否落了盘（读数为空 / 写失败 ⇒ false，调用方照旧收尾，不阻断）
 */
export function mergeTimingLedger(root, readings) {
  const usable = (readings ?? []).filter((r) => r && r.name && Number.isFinite(r.ms) && r.ms >= 0);
  if (usable.length === 0) {
    return false;
  }
  const files = {};
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, TIMING_LEDGER_REL), "utf8"));
    Object.assign(files, raw.files ?? {});
  } catch {
    // 冷启动：没有台账就从这一跑开始建。
  }
  for (const r of usable) {
    files[r.name] = Math.round(r.ms);
  }
  try {
    fs.writeFileSync(
      path.join(root, TIMING_LEDGER_REL),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}
