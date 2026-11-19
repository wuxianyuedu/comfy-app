#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * premerge-timing.mjs — `pnpm check:premerge` 每一跑的**本机逐格账**（ISSUE #2832）。
 *
 * ── 为什么要有它 ─────────────────────────────────────────────────────────
 *
 * #2832 的现场：premerge 一跳 8–10 分钟，但「tsc 占几分钟、eslint 占几分钟、几十条
 * 静态判据合计几分钟」没人答得上来 —— 优化讨论只能停留在猜测。对照物是
 * `precommit-timing.mjs`（pre-commit 的 D0 有逐格账，`.tmp/timing/comfy-precommit-timing.jsonl`），
 * premerge 这一跳当年从它旁边走过时没把计时带上。
 *
 * ── 形态（与 precommit-timing 同一口径，两处共有的理由只写一次）──────────
 *
 * 落在 `<检出根>/.tmp/timing/comfy-premerge-timing.jsonl`（JSONL，一次一行，追加写）。
 * `.tmp/` 是本机作业目录（`.gitignore`、规范 §12.8.7），`timing/` 归钩子/门禁耗时账。
 * 为什么不入库、也不放 `log/`、为什么**不是门禁**（记账失败只往 stderr 说一句、
 * 绝不影响退出码）：逐字同 §13.5.8.3 那段 —— 那里的理由是这一族共有的，本文件不抄。
 *
 * ⚠️ 工作树根**现算**（`resolveRepoRoot`），不硬编码 `<root>/.tmp`：`base-check.mjs`
 * 自己就跑在 worktree 里，账要记的是**当前这份工作树**的耗时 —— 硬编码会把账写飞。
 *
 * ── 读账（人看）──────────────────────────────────────────────────────────
 *
 * 裸跑打最近 10 次的表（逐次总墙钟 + 逐格中位数前 10）；`--last N` 看更多；
 * `--json` 给机器可读的原始记录。只读不判 —— 本文件没有 process.exit，
 * 也不进任何门禁（§12.18：它不判失败，只是把账翻给人看）。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveRepoRoot } from "../lib/git-dir.mjs";
import { median } from "./precommit-timing.mjs";

/** 一次跑的账怎么排给人看：快照建树单独一格 + 最慢 5 条 + 合计。 */
const SUMMARY_TOP = 5;

/** 读账侧默认看最近多少次（与 precommit-timing 同一口径）。 */
const DEFAULT_LAST = 10;

/** 账本在 `.tmp/` 下的子目录（规范 §12.8.7：按生产者分目录）。 */
const TIMING_SUBDIR = [".tmp", "timing"];

/** 账本文件名。 */
const LEDGER_NAME = "comfy-premerge-timing.jsonl";

/**
 * 把一次跑的逐格读数追加进台账（best-effort：任何失败回 false，不抛）。
 *
 * @param {{at: string, ref: string, totalMs?: number, trigger?: string, entries: Array<{label: string, ms: number}>}} run
 *   `ref` 是这次复算对的上游（读数按「对哪个基线」才有可比性）；`entries` 来自
 *   `baseCheckMany` 的 `onTiming` + 两个脚本段的墙钟；`totalMs` 是本次复算的**总墙钟**
 *   （各格有并发，相加不是墙钟 —— 所以两格都记）；`trigger` 记这次是谁触发的
 *   （pre-push 自动触发 = "pre-push"，手工跑 = "manual"）。
 * @param {{cwd?: string}} [opts] `cwd` 是判定「哪份工作树」的检出（默认 `process.cwd()`）
 * @returns {boolean}
 */
export function recordTimingLedger(run, opts = {}) {
  try {
    if (!run || !Array.isArray(run.entries) || run.entries.length === 0) {
      return false;
    }
    const root = resolveRepoRoot(opts.cwd ?? process.cwd());
    if (!root) {
      return false;
    }
    const dir = path.join(root, ...TIMING_SUBDIR);
    const line = `${JSON.stringify({
      at: run.at,
      ref: run.ref,
      /* 没给 / 不是有限数就不写这个键（undefined 会被 JSON.stringify 丢掉）——
       * 旧记录与「这次没量到」都不冒充一个 0。 */
      totalMs: Number.isFinite(run.totalMs) ? Math.round(run.totalMs) : undefined,
      /* trigger 缺省就是 manual：不是 push 自动触发的，只可能是手工跑的，没有第三态 ——
       * 写侧落定，账自己说得清「这次是谁跑的」。 */
      trigger: typeof run.trigger === "string" && run.trigger ? run.trigger : "manual",
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
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, LEDGER_NAME), line, "utf8");
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
      ).toFixed(1)}s（完整表看 .tmp/timing 里的 ${LEDGER_NAME}）`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// ── 读账（人看）──────────────────────────────────────────────────────────

/**
 * 读整份账本。读不出（还没跑过 / 不在检出里）返回空数组 —— 与「账本是空的」同形，
 * 报表那侧照实说「没有记录」，不冒充读数。
 *
 * @param {string} [cwd]
 * @returns {Array<Record<string, unknown>>}
 */
export function readTimingRuns(cwd = process.cwd()) {
  try {
    const root = resolveRepoRoot(cwd);
    if (!root) {
      return [];
    }
    const text = fs.readFileSync(path.join(root, ...TIMING_SUBDIR, LEDGER_NAME), "utf8");
    /** @type {Array<Record<string, unknown>>} */
    const out = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          out.push(parsed);
        }
      } catch {
        /* 半截行（上次写入被打断）不构成一条记录。 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 账本 → 人读的文本。逐次一行（总墙钟 / 触发来源 / 对哪个基线 / 逐格条数），
 * 再给跨次的逐格中位数排名（单次读数受负载影响大，中位数回答「通常多少」）。
 *
 * @param {Array<Record<string, unknown>>} runs
 * @param {{last?: number}} [opts]
 * @returns {string}
 */
export function formatTimingLedgerReport(runs, opts = {}) {
  const last = opts.last ?? DEFAULT_LAST;
  if (runs.length === 0) {
    return (
      "[premerge-timing] 还没有记录 —— 跑一次 `pnpm check:premerge`（或一次触发复算的 push）" +
      `就会有一条（账本 .tmp/timing/${LEDGER_NAME}，本机、不入库）。\n`
    );
  }
  const shown = runs.slice(-last);
  const lines = [
    `[premerge-timing] 最近 ${shown.length} 次（共 ${runs.length} 条；账本 .tmp/timing/${LEDGER_NAME}，本机、不入库）`,
    "",
    "  逐次（新 → 旧；总 = 本次复算总墙钟，逐格因并发在同时跑、相加不是墙钟）：",
  ];
  for (const run of [...shown].reverse()) {
    const at = String(run.at ?? "?")
      .replace("T", " ")
      .slice(0, 19);
    const total = Number(run.totalMs);
    const entries = Array.isArray(run.entries) ? run.entries : [];
    const sum = entries.reduce((a, e) => a + (Number(e?.ms) || 0), 0);
    lines.push(
      `    ${at}  总 ${Number.isFinite(total) ? `${(total / 1000).toFixed(1)}s` : "（未记）"}  ` +
        `${String(run.trigger ?? "manual")}  对 ${String(run.ref ?? "?")}  ` +
        `逐格 ${entries.length} 条 / 相加 ${(sum / 1000).toFixed(1)}s`,
    );
  }
  /** @type {Map<string, number[]>} */
  const byLabel = new Map();
  for (const run of shown) {
    for (const e of Array.isArray(run.entries) ? run.entries : []) {
      if (e && typeof e.label === "string" && Number.isFinite(e.ms) && e.ms >= 0) {
        byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), Number(e.ms)]);
      }
    }
  }
  const ranked = [...byLabel.entries()]
    .map(([label, values]) => ({ label, ms: median(values), n: values.length }))
    .sort((a, b) => b.ms - a.ms);
  if (ranked.length > 0) {
    lines.push("");
    lines.push(`  逐格（中位数，前 ${Math.min(10, ranked.length)} 名）：`);
    for (const r of ranked.slice(0, 10)) {
      lines.push(
        `    ${(r.ms / 1000).toFixed(1)}s  ${r.label}${r.n < shown.length ? `（${r.n}/${shown.length} 次有记录）` : ""}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/** `--last N` / `--last=N` 两种写法都收；缺省 10。 */
function lastArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--last") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) {
        return v;
      }
    } else if (typeof a === "string" && a.startsWith("--last=")) {
      const v = Number(a.slice("--last=".length));
      if (Number.isFinite(v) && v > 0) {
        return v;
      }
    }
  }
  return DEFAULT_LAST;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const argv = process.argv.slice(2);
  const runs = readTimingRuns();
  process.stdout.write(
    argv.includes("--json")
      ? `${JSON.stringify(runs, null, 2)}\n`
      : formatTimingLedgerReport(runs, { last: lastArg(argv) }),
  );
}
