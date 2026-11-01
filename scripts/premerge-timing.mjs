#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * premerge-timing.mjs — `pnpm check:premerge` 每一跑的**本机逐格账**（ISSUE #2832）。
 *
 * ── 为什么要有它 ─────────────────────────────────────────────────────────
 *
 * #2832 的现场：premerge 一跳 8–10 分钟，但「tsc 占几分钟、eslint 占几分钟、几十条
 * 静态判据合计几分钟」没人答得上来 —— 优化讨论只能停留在猜测。对照物是
 * `precommit-timing.mjs`（pre-commit 的 D0 有逐格账，`.git/comfy-precommit-timing.jsonl`），
 * premerge 这一跳当年从它旁边走过时没把计时带上。
 *
 * ── 形态（与 precommit-timing 同一口径，两处共有的理由只写一次）──────────
 *
 * 落在 `.git/comfy-premerge-timing.jsonl`（JSONL，一次一行，追加写）。
 * 为什么不入库、也不放 `log/`、为什么**不是门禁**（记账失败只往 stderr 说一句、
 * 绝不影响退出码）：逐字同 §13.5.8.3 那段 —— 那里的理由是这一族共有的，本文件不抄。
 *
 * ⚠️ git 目录**现算**（`resolveGitDir`），不硬编码 `<root>/.git`：`base-check.mjs`
 * 自己就跑在 worktree 里，那份的 `.git` 是一个文件 —— 硬编码会把账写飞。
 */

import fs from "node:fs";
import path from "node:path";

import { resolveGitDir } from "./git-dir.mjs";

/** 一次跑的账怎么排给人看：快照建树单独一格 + 最慢 5 条 + 合计。 */
const SUMMARY_TOP = 5;

/**
 * 把一次跑的逐格读数追加进台账（best-effort：任何失败回 false，不抛）。
 *
 * @param {{at: string, ref: string, entries: Array<{label: string, ms: number}>}} run
 *   `ref` 是这次复算对的上游（读数按「对哪个基线」才有可比性）；`entries` 来自
 *   `baseCheckMany` 的 `onTiming` + 两个脚本段的墙钟。
 * @param {{cwd?: string}} [opts] `cwd` 是判定「哪份 `.git`」的检出（默认 `process.cwd()`）
 * @returns {boolean}
 */
export function recordTimingLedger(run, opts = {}) {
  try {
    if (!run || !Array.isArray(run.entries) || run.entries.length === 0) {
      return false;
    }
    const dir = resolveGitDir(opts.cwd ?? process.cwd());
    const line = `${JSON.stringify({
      at: run.at,
      ref: run.ref,
      /* 脏读数（无 label / 非有限 / 负）在门口滤掉 —— NaN 会被 JSON.stringify 写成 null，
       * 账上留一格 null 让下一份读账的工具当场哑掉。 */
      entries: run.entries
        .filter(
          (e) =>
            e &&
            typeof e.label === "string" &&
            e.label !== "" &&
            Number.isFinite(e.ms) &&
            e.ms >= 0,
        )
        .map((e) => ({ label: String(e.label), ms: Math.round(e.ms) })),
    })}\n`;
    fs.appendFileSync(path.join(dir, "comfy-premerge-timing.jsonl"), line, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 把逐格读数排成给人看的那一段（stderr 用的纯文本；纯函数，不落盘）。
 *
 * 快照建树单独一行（它是「这 10 分钟里有几分钟在搭台子」的那一格）；
 * 其余按毫秒降序取前 5（tsc / eslint 应该一眼可见）；合计与条数收尾。
 *
 * @param {Array<{label: string, ms: number}>} entries
 * @returns {string}
 */
export function formatTimingSummary(entries) {
  const usable = (entries ?? []).filter((e) => e?.label && Number.isFinite(e.ms) && e.ms >= 0);
  if (usable.length === 0) {
    return "[premerge-timing] 这一跑没有逐格读数（快照没建 / 段全被跳过）\n";
  }
  const total = usable.reduce((a, e) => a + e.ms, 0);
  const sorted = [...usable].sort((a, b) => b.ms - a.ms);
  const snapshot = sorted.filter((e) => e.label.startsWith("快照建树"));
  const rest = sorted.filter((e) => !e.label.startsWith("快照建树"));
  const lines = [
    `[premerge-timing] 逐格读数 ${usable.length} 条 / 合计 ${(total / 1000).toFixed(1)}s（并发无关，纯相加）`,
    ...snapshot.map((e) => `  ${e.label}: ${(e.ms / 1000).toFixed(1)}s`),
    ...rest.slice(0, SUMMARY_TOP).map((e) => `  ${(e.ms / 1000).toFixed(1)}s  ${e.label}`),
  ];
  if (rest.length > SUMMARY_TOP) {
    lines.push(
      `  ……其余 ${rest.length - SUMMARY_TOP} 条合计 ${(
        rest.slice(SUMMARY_TOP).reduce((a, e) => a + e.ms, 0) / 1000
      ).toFixed(1)}s（完整表看 .git 里的 comfy-premerge-timing.jsonl）`,
    );
  }
  return `${lines.join("\n")}\n`;
}
