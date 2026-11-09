#!/usr/bin/env node
/**
 * ship-result.mjs —— 「上一次 ship 到底做了什么」的**落盘回读点**（ISSUE #3206）。
 *
 * 立案现场：ship 在后台终端里跑（输出重定向到日志、或进程被 SIGTERM）时，
 * 下一轮会话看不出上一跑跑到哪一步、有没有给结论 —— 读数都在，但只在那一块
 * 屏幕上，没有一份进程自己写下的、随时可读的事实源。后台完成**不保证唤醒**，
 * 所以「等通知」不是判据；能依赖的只有开跑那一刻就落盘的文件。
 *
 * ── 四条刻意的形状 ──────────────────────────────────────────
 *
 * 1. **write-ahead**：`createShipResultSink()` 一创建就写一笔 `status=running`，
 *    此后每笔 `log()` 同步追加。被 SIGTERM / 超时杀掉时，文件停在最后一行读数，
 *    下一轮回读能看出「走到哪停了」，而不是一片空白。`running` / `interrupted`
 *    一律是「没给结论」—— 与三态退码 `2 = 没跑起来` 同口径，不许读成通过。
 * 2. **只转述，不判定**：`stages` 从 `reportStage` 的 `[ship] ▶ …` 行提取、
 *    `conclusion` 取屏幕上最后一句结论类声明原文、`exitCode` 取 `main()`
 *    唯一出口的返回值。身份字段（branch / sha / repo / pr）是从读数行里
 *    **尽力而为**地认出来的，取不到落 null，绝不反过来当判据。
 * 3. **写盘 best-effort**：任何写失败都吞掉。这一格是读数不是判据，绝不因为
 *    落盘失败改变 ship 的三态退码或打印原文（硬规则 28 红线③）。
 * 4. **落点由调用方显式给**：编排层默认不落盘，只有 CLI 入口传真实
 *    `resolveGitDir` 才写这一轮。几十条 `main({...})` 注入用例共用本仓真实检出，
 *    若默认落盘，跑完测试「上一次 ship」就变成测试假读数 —— 恰好把这一格
 *    要守的事实源污染掉。
 *
 * 落点复用 `git-dir.mjs` 的 `gitScratchPath()`：与 `comfy-premerge-proof.json`
 * 同族 —— 描述的是**这台检出**的状态，不入库、不跨检出互证。
 *
 * 用法（只读回读口，一次也不改状态）：
 *   node scripts/ship-result.mjs            # 人类可读摘要
 *   node scripts/ship-result.mjs --json     # 原始读数（含 result / reason）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { gitScratchPath, resolveGitDir } from "./git-dir.mjs";

const SHIP_RESULT_FILE = "ship-result.json";
/** 读数行上限：超了保留开头 20 行（身份）与末尾 480 行（停在何处）。 */
const MAX_LINES = 500;
const HEAD_LINES = 20;

/**
 * @typedef {{
 *   version: number,
 *   status: string,
 *   startedAt: string,
 *   finishedAt: string | null,
 *   interruptedBy: string | null,
 *   pid: number,
 *   cwd: string,
 *   argv: string[],
 *   branch: string | null,
 *   headSha: string | null,
 *   repo: string | null,
 *   pr: number | null,
 *   stages: string[],
 *   lines: string[],
 *   lineCount: number,
 *   truncated: boolean,
 *   exitCode: number | null,
 *   conclusion: string | null,
 * }} ShipResult
 */

/**
 * @typedef {{
 *   found: boolean,
 *   path: string | null,
 *   result: ShipResult | null,
 *   reason: "ok" | "no-git-dir" | "missing" | "unreadable" | null,
 * }} ShipResultReading
 */

/** 身份 / 阶段 / 结论三种读数行的形状：只认 `reportStage` 与 `finish` 的原文。 */
const IDENTITY_RE = /^\[ship\] 分支 (?<branch>\S+) · sha (?<sha>\S+) · 仓库 (?<repo>\S+)/;
const PR_RE = /^\[ship\] ▶ (?:新建 PR|复用 PR) \| pr=(?<pr>\d+)/;
const STAGE_PREFIX = "[ship] ▶ ";
const CONCLUSION_PREFIX = "[ship] 结论：";
/** 收尾回收可能把先前那句结论推翻；屏幕上更晚的这一句同属结论类声明。 */
const FINAL_CONCLUSION_PREFIX = "[ship] 含收尾回收的最终结论：";
/** `ship-preflight` 用这两个串标「取不到」：是占位，不是仓库名 / 分支名。 */
const PLACEHOLDERS = new Set(["(取不到)", "(无)"]);

/**
 * 落盘路径。取不到 git 目录时回 null ⇒ 这一格**跳过写**，不往工作区猜一个路径。
 * @param {string} [root]
 * @param {(cwd?: string) => string | null} [resolve]
 * @returns {string | null}
 */
function shipResultPath(root = process.cwd(), resolve = resolveGitDir) {
  return gitScratchPath(root, SHIP_RESULT_FILE, resolve);
}

/**
 * 建一次 ship 的落盘 sink。**创建即写**（`running`），返回包装 log / 收口三件套。
 *
 * @param {{ root?: string, args?: string[],
 *           resolve?: (cwd?: string) => string | null,
 *           now?: () => string, pid?: number }} [io]
 */
export function createShipResultSink(io = {}) {
  const root = io.root ?? process.cwd();
  const now = io.now ?? (() => new Date().toISOString());
  const filePath = shipResultPath(root, io.resolve ?? resolveGitDir);
  /** @type {ShipResult} */
  const result = {
    version: 1,
    status: "running",
    startedAt: now(),
    finishedAt: null,
    interruptedBy: null,
    pid: io.pid ?? process.pid,
    cwd: root,
    argv: io.args ?? process.argv.slice(2),
    branch: null,
    headSha: null,
    repo: null,
    pr: null,
    stages: [],
    lines: [],
    lineCount: 0,
    truncated: false,
    exitCode: null,
    conclusion: null,
  };
  const flush = () => {
    if (!filePath) {
      return;
    }
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    } catch {
      // 落盘结论是读数不是判据：写不出去绝不改 ship 的退码。
    }
  };
  let identitySeen = false;
  /** 一行一行收：relay 转述的子进程输出是整段文本，也要拆成单行读数。 */
  const append = (/** @type {string} */ chunk) => {
    for (const text of String(chunk).split(/\r?\n/)) {
      if (!text) {
        continue;
      }
      result.lines.push(text);
      result.lineCount += 1;
      if (!identitySeen) {
        const identity = IDENTITY_RE.exec(text)?.groups;
        if (identity) {
          identitySeen = true;
          /* 缺读数那一格由上游念「取不到」；落盘不把占位当成正经身份。 */
          const read = (/** @type {string | undefined} */ v) =>
            v && !PLACEHOLDERS.has(v) ? v : null;
          result.branch = read(identity.branch);
          result.headSha = read(identity.sha);
          result.repo = read(identity.repo);
        }
      }
      if (text.startsWith(STAGE_PREFIX)) {
        result.stages.push(text.slice(STAGE_PREFIX.length));
      }
      const pr = PR_RE.exec(text)?.groups?.pr;
      if (pr) {
        result.pr = Number(pr);
      }
      /* 只转述、不判定：同轮若出现更晚的一句（收尾回收改了退码），落盘跟着改口，
       * 免得回读里留一句已经被屏幕下一行推翻的结论。 */
      if (text.startsWith(CONCLUSION_PREFIX) || text.startsWith(FINAL_CONCLUSION_PREFIX)) {
        result.conclusion = text;
      }
    }
    if (result.lines.length > MAX_LINES) {
      result.lines = [
        ...result.lines.slice(0, HEAD_LINES),
        ...result.lines.slice(-(MAX_LINES - HEAD_LINES)),
      ];
      result.truncated = true;
    }
    flush();
  };
  flush();
  return {
    path: filePath,
    result,
    append,
    /** @param {(s: string) => void} rawLog @returns {(s: string) => void} */
    wrapLog(rawLog) {
      return (s) => {
        append(s);
        rawLog(s);
      };
    },
    /** 编排抛异常：留一笔「没给结论」，再把原异常照原样抛回去。 @param {unknown} error */
    fail(error) {
      result.status = "interrupted";
      result.finishedAt = now();
      result.interruptedBy = error instanceof Error ? error.message : String(error);
      flush();
    },
    /** 唯一出口收口。退码按三态分类，绝不在这里另立判定。 @param {number} code */
    finish(code) {
      result.status = code === 0 ? "green" : code === 1 ? "red" : "not-run";
      result.exitCode = code;
      result.finishedAt = now();
      flush();
    },
  };
}

/**
 * 落盘文件是**外部输入**（可能来自旧版本、被手工改过、写到一半被杀），形状对不上
 * 就落「读不出来」，不许按 `ShipResult` 用下去。用类型守卫而不是断言，是为了不让
 * `JSON.parse` 的 `any` 在这里悄悄变成一个「看起来已经验过」的类型。
 * @param {unknown} value
 * @returns {value is ShipResult}
 */
function isShipResult(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    "status" in value &&
    typeof value.status === "string" &&
    "startedAt" in value &&
    typeof value.startedAt === "string" &&
    "stages" in value &&
    Array.isArray(value.stages) &&
    "lines" in value &&
    Array.isArray(value.lines)
  );
}

/**
 * 回读。**「文件不在」与「文件读不出来」是两件事**：前者是合法读数（还没有上一次），
 * 后者是这一格没跑起来，不许合并成一句「没有结论」就完事。
 *
 * @param {string} [root]
 * @param {(cwd?: string) => string | null} [resolve]
 * @returns {ShipResultReading}
 */
export function readShipResult(root = process.cwd(), resolve = resolveGitDir) {
  const filePath = shipResultPath(root, resolve);
  if (!filePath) {
    return { found: false, path: null, result: null, reason: "no-git-dir" };
  }
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return { found: false, path: filePath, result: null, reason: "missing" };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { found: false, path: filePath, result: null, reason: "unreadable" };
  }
  if (!isShipResult(parsed)) {
    return { found: false, path: filePath, result: null, reason: "unreadable" };
  }
  return { found: true, path: filePath, result: parsed, reason: "ok" };
}

/**
 * 把回读结果念成人能一眼看懂的几行。**只读，不改状态、不另立结论**。
 * @param {ShipResultReading} reading
 * @returns {string[]}
 */
export function formatShipResult(reading) {
  /** @type {string[]} */
  const lines = [];
  if (!reading.found) {
    if (reading.reason === "no-git-dir") {
      lines.push("[ship-result] 取不到 git 目录 ⇒ 没有落盘结论可读（这一格没跑起来）。");
    } else if (reading.reason === "unreadable") {
      lines.push(
        `[ship-result] 落盘读数读不出来（JSON 形状不对：${reading.path}）⇒ 没跑起来，不构成结论。`,
      );
    } else {
      lines.push(`[ship-result] 没有上一次 ship 的落盘读数（${reading.path}）⇒ 不构成结论：`);
      lines.push("  既不是「没跑过」，也不是「通过了」；先跑一次 `pnpm ship` 再回读。");
    }
    return lines;
  }
  const r = reading.result;
  if (!r) {
    return lines;
  }
  lines.push(`[ship-result] 回读点：${reading.path}`);
  lines.push(
    `[ship-result] 上一次 ship：${r.startedAt} → ${r.finishedAt ?? "未收口"} · ` +
      `status=${r.status} · exit=${r.exitCode ?? "无"}`,
  );
  lines.push(
    `[ship-result] 分支 ${r.branch ?? "未读到"} · sha ${r.headSha ?? "未读到"} · ` +
      `仓库 ${r.repo ?? "未读到"} · PR ${r.pr ?? "未读到"}`,
  );
  lines.push(`[ship-result] 走到哪（${r.stages.length} 格）：`);
  for (const stage of r.stages) {
    lines.push(`  ▶ ${stage}`);
  }
  lines.push(`[ship-result] 结论：${r.conclusion ?? "这一跑没念结论行"}`);
  if (r.status === "running" || r.status === "interrupted") {
    lines.push(
      `[ship-result] ⚠ status=${r.status} ⇒ 这一跑**没给结论**，不许当成通过；` +
        "下面末尾读数行就是它停下的地方。",
    );
  }
  lines.push("[ship-result] 末尾读数：");
  for (const line of r.lines.slice(-5)) {
    lines.push(`  ${line}`);
  }
  return lines;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const reading = readShipResult();
  if (process.argv.slice(2).includes("--json")) {
    process.stdout.write(`${JSON.stringify(reading, null, 2)}\n`);
  } else {
    for (const line of formatShipResult(reading)) {
      process.stdout.write(`${line}\n`);
    }
  }
  /* 「没有上一次」是合法读数（0）；「读不出来 / 取不到 git 目录」才是没跑起来（2）。 */
  process.exit(reading.found || reading.reason === "missing" ? 0 : 2);
}
