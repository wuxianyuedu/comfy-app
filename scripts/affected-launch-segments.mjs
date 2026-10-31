#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * affected-launch-segments.mjs — 「固定 / 受影响」两段怎么切、段开关怎么读（ISSUE #2845）。
 *
 * 从 `run-affected-tests.mjs` 拆出来的理由不是行数好看（infra R5 的 900 硬闸在 #2845 现场
 * 报出来：926 行），而是**变化方向不同**：这一层是**纯规划**（清单怎么切成带 `kind` 的块、
 * 段开关取什么值），而 `run-affected-tests.mjs` 是**执行编排**（spawn、判决链、复跑预算）。
 * 两者各自演进：加段、改分块策略动这一份；动判决与预算动那一份。
 *
 * 判据一个字不搬：分块的防丢防重由 `planLaunches` 自己那组用例钉着（#2823 落地时的
 * `tests/affected-launch-separation.test.ts`），段开关的取值面（不设=both / 认不出=invalid）
 * 也在同一份文件里钉。
 */

import { planLaunches } from "./affected-launch-spawn.mjs";
import { FIXED_STRUCTURAL_TESTS } from "./fixed-structural-tests.mjs";

/**
 * 固定段单块的最大份数（ISSUE #2863）。
 *
 * 为什么要有这一帽：fixed 段是**静态大清单**（实测 106 份），而 argv 预算（24000 字符）
 * 装得下它们 ⇒ `planLaunches` 只会切出**一块** —— 于是任何一份带超时指纹，判决链都以
 * 「整块 106 份」为粒度（实测 cnb-bo5-1k68vik3o：一份 30s 超时 ⇒ 整块进复跑判决链，
 * 靠墙钟判点救成逐文件补跑，那是预算判出来的侥幸，不是结构保证）。
 *
 * 24 ⇒ 106 份切成 5 块：复跑粒度降一个量级，代价是多 4 次 vitest 冷启（每次秒级）。
 * 不是松紧量：调它只改变「一份假红要陪跑多少份」与冷启次数，任何断言的判定都不随它变。
 * 受影响段**不**戴这顶帽：它的面由 import 图决定（宽回退那一路本来就放弃收窄），
 * 常态远小于固定段，帽它只会多付冷启。
 */
export const FIXED_CHUNK_FILES = 24;

/**
 * 把「固定清单（契约 / 结构守护）」与「这个 PR 牵扯到的受影响用例」**分开分块**。
 *
 * 为什么要分开（2026-10-31 的现场）：两者混在同一次 vitest 调用里时，固定清单里那份最吵的
 * a11y 故事测试（`tests/a11y-axe-stories.test.ts`，故意渲染会抛错的 error-boundary /
 * lazy-chunk 故事）的 stderr 噪音会和受影响用例的真红混在一起、把失败原文挤出去（平台只
 * 保留日志尾部）。分开后：
 *   · 每份启动更小（固定清单先跑、受影响用例后跑，受影响用例的失败与收尾账落在日志尾部）；
 *   · 噪音被收进「固定清单」那一段里隔离，且两块各有独立抬头（便于读日志的人分辨哪块红了）。
 *
 * 不改变任何判决：分块策略与 `planLaunches` 完全一致（同一份预算、同一套防丢防重），只是
 * 先按 `FIXED_STRUCTURAL_TESTS` 切两刀、各自分块，再拼回一个带 `kind` 的序列。固定段
 * 先按 `FIXED_CHUNK_FILES` 预切（复跑粒度，见该常量的文档），每片仍各自过 `planLaunches`
 * 的命令行预算 —— 两个帽同时生效，谁紧听谁。
 *
 * 段开关（ISSUE #2845）下调用方先按段裁好清单再交进来 —— 只剩一段时这里天然只产出该段的块。
 *
 * @param {string[]} files 已含固定清单的完整清单（`collectList()` 的产出，或段开关裁过的子集）
 * @param {{fixedChunkFiles?: number}} [opts] 固定段单块份数帽；缺省 `FIXED_CHUNK_FILES`，
 *   传 0 / 负数 = 不帽（回到纯预算分块的旧行为）
 * @returns {{kind: 'fixed' | 'affected', files: string[]}[]}
 */
export function planSeparatedLaunches(files, opts = {}) {
  /* 帽的取值语义：**没给**（键不在）= 缺省 `FIXED_CHUNK_FILES`；**显式 0 / 负数** = 关帽
   * （回到纯预算分块的旧行为）。`i += 0` 会死循环，所以关帽走单独一支而不是把 0 喂进循环。 */
  const raw = opts.fixedChunkFiles;
  const cap = raw === undefined
    ? FIXED_CHUNK_FILES
    : Number.isInteger(raw) && raw > 0 ? raw : 0;
  const fixed = files.filter((f) => FIXED_STRUCTURAL_TESTS.includes(f));
  const affected = files.filter((f) => !FIXED_STRUCTURAL_TESTS.includes(f));
  /** @type {{kind: 'fixed' | 'affected', files: string[]}[]} */
  const out = [];
  if (cap > 0) {
    for (let i = 0; i < fixed.length; i += cap) {
      for (const chunk of planLaunches(fixed.slice(i, i + cap))) {
        out.push({ kind: "fixed", files: chunk });
      }
    }
  } else {
    for (const chunk of planLaunches(fixed)) out.push({ kind: "fixed", files: chunk });
  }
  for (const chunk of planLaunches(affected)) out.push({ kind: "affected", files: chunk });
  return out;
}

/**
 * 段开关（ISSUE #2845）：把「固定 / 受影响」从**一条 stage 里的两个块**升级成
 * **两个 CI stage**。`COMFY_AFFECTED_SEGMENT=fixed|affected` 让本进程只跑那一段，
 * 平台上两格各有自己的日志与判决，两段摘要不再互相掺杂。
 *
 * 缺省（不设 / 空）= `both`：本地与既有跑法逐字一致（一个进程里固定先、受影响后）。
 * 认不出的值 ⇒ `invalid`，调用方退 2 并点名 —— 吞掉未知值，开关就失去了「说没生效
 * 要读得回来」的那一半。
 *
 * @param {string | undefined} raw `COMFY_AFFECTED_SEGMENT` 的原值
 * @returns {{mode: "both" | "fixed" | "affected" | "invalid", note: string | null}}
 */
export function resolveAffectedSegment(raw) {
  const v = (raw ?? "").trim();
  if (v === "") {
    return { mode: "both", note: null };
  }
  if (v === "fixed" || v === "affected") {
    const tag = v === "fixed" ? "固定结构用例" : "受影响用例";
    return {
      mode: v,
      note: `段开关：${v} —— 本进程只跑「${tag}」那一段（ISSUE #2845，两段已拆成两个 CI stage）`,
    };
  }
  return {
    mode: "invalid",
    note: `COMFY_AFFECTED_SEGMENT 只认 fixed / affected / 不设，来了个「${raw}」`,
  };
}
