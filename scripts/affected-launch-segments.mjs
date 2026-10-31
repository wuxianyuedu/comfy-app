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
 * 先按 `FIXED_STRUCTURAL_TESTS` 切两刀、各自分块，再拼回一个带 `kind` 的序列。
 *
 * 段开关（ISSUE #2845）下调用方先按段裁好清单再交进来 —— 只剩一段时这里天然只产出该段的块。
 *
 * @param {string[]} files 已含固定清单的完整清单（`collectList()` 的产出，或段开关裁过的子集）
 * @returns {{kind: 'fixed' | 'affected', files: string[]}[]}
 */
export function planSeparatedLaunches(files) {
  const fixed = files.filter((f) => FIXED_STRUCTURAL_TESTS.includes(f));
  const affected = files.filter((f) => !FIXED_STRUCTURAL_TESTS.includes(f));
  /** @type {{kind: 'fixed' | 'affected', files: string[]}[]} */
  const out = [];
  for (const chunk of planLaunches(fixed)) {
    out.push({ kind: "fixed", files: chunk });
  }
  for (const chunk of planLaunches(affected)) {
    out.push({ kind: "affected", files: chunk });
  }
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
