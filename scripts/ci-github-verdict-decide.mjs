#!/usr/bin/env node
/**
 * `ci-github-verdict-decide.mjs` —— 把回读格留下的**判定文件**换成流水线的退码。
 *
 * ## 为什么退码要晚一格
 *
 * `GitHub 判决回读` 这一格的产物有两条：一条是**判定**（三态 → 退码），一条是**读数**
 * （失败 job 的日志；全量走 `日志分块 1..N` 那几格）。CNB 的 stage 是串行的，前一格红
 * 后面就不跑了 —— 而「判红」恰恰是最需要看日志的那一形。所以顺序拆成：
 *
 *   ① `GitHub 判决回读`：跑三态、把结论写进
 *      `.comfy-ci/tmp/github-verdict-logs/decision.json`，**退 0**；
 *   ② `日志分块 1..N`：把失败日志的全量分块打进 stage 日志（读不到就各念一行，退 0）；
 *   ③ `GitHub 判决判定`（本文件）：读①那份文件，**退真码** —— 红就拦合，判不了也拦合。
 *
 * ## 边界（fail-closed）
 *
 * 本文件只有三种出口，且**都不许落回 0**：
 *
 *   · 判定文件**读不到 / 不是合法 JSON / 形状不对** ⇒ exit 2（`判不了` 不许被读成 `通过`）；
 *   · 判定写的是 `exit 1`（GitHub 侧判红）⇒ exit 1；
 *   · 判定写的是 `exit 2`（没跑起来 / 没结论）⇒ exit 2。
 *
 * 换句话说：**只有**判定文件明确写着 `0` 才放行 —— 与回读格那套三态一字不差，
 * 本文件不做第二次判读、也不替它「折中」。
 *
 * 用法：
 *
 * ```text
 * node scripts/ci-github-verdict-decide.mjs [判定文件]
 * ```
 *
 * 缺省路径是 `.comfy-ci/tmp/github-verdict-logs/decision.json`（与回读格的 `--decision-out` 同源）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** 本仓检出根（`scripts/` 的上一层）。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/** 判定文件的缺省位置（相对检出根）。 */
export const DEFAULT_DECISION_FILE = ".comfy-ci/tmp/github-verdict-logs/decision.json";

/** 三态退码里**允许**出现在判定文件里的那几个（别的值一律按「判不了」处置）。 */
const ALLOWED_EXIT_CODES = new Set([0, 1, 2]);

/**
 * 是不是一个可按键取值的对象（`JSON.parse` 的结果是 `unknown`，先过这一跳）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 可按键取值
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 把判定文件的内容收口成退码（形状不对 ⇒ `null`）。
 *
 * @param {unknown} parsed `JSON.parse` 的结果
 * @returns {{exitCode: number, line: string} | null} 判定读数
 */
export function normalizeDecision(parsed) {
  if (!isRecord(parsed)) {
    return null;
  }
  const record = parsed;
  const exitCode = record.exitCode;
  if (typeof exitCode !== "number" || !ALLOWED_EXIT_CODES.has(exitCode)) {
    return null;
  }
  return {
    exitCode,
    line: typeof record.line === "string" ? record.line : "",
  };
}

/**
 * 读判定文件并给出「这一格该退什么」——纯读数，不抛异常。
 *
 * @param {string} file 判定文件路径（绝对或相对检出根）
 * @param {{readFile?: (file: string) => string, root?: string}} [io] 注入面
 * @returns {{exitCode: number, text: string}} 退出码与要打的那一行
 */
export function decide(file, io = {}) {
  const readFile = io.readFile ?? ((target) => String(readFileSync(target, "utf8")));
  const abs = path.isAbsolute(file) ? file : path.join(io.root ?? ROOT, file);
  /** @type {ReturnType<typeof normalizeDecision>} */
  let decision = null;
  /** @type {string} */
  let why = "";
  try {
    decision = normalizeDecision(JSON.parse(readFile(abs)));
  } catch (error) {
    why = String(error).split("\n")[0] ?? "";
  }
  if (decision === null) {
    return {
      exitCode: 2,
      text:
        `[verdict] 判定：回读格没有留下可用的判定文件（${abs}${why === "" ? "" : `；${why}`}）—— ` +
        "fail-closed：判不了就拦合（exit 2）",
    };
  }
  const source = decision.line === "" ? "" : `（回读行：${decision.line}）`;
  return {
    exitCode: decision.exitCode,
    text: `[verdict] 判定：回读格留下的三态 = exit ${String(decision.exitCode)}${source}`,
  };
}

/**
 * 参数收口：位置参数可缺省（缺省走 {@link DEFAULT_DECISION_FILE}）。
 *
 * @param {string[]} argv
 * @returns {{file: string}} 判定文件路径
 */
export function parseArgs(argv) {
  const [first] = argv;
  return { file: first === undefined || first === "" ? DEFAULT_DECISION_FILE : first };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { file } = parseArgs(process.argv.slice(2));
  const { exitCode, text } = decide(file);
  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}
