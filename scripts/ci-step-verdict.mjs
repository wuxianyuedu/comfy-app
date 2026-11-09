#!/usr/bin/env node
/**
 * `ci-step-verdict.mjs` — GitHub 侧「一步红了，为什么」的**唯一出口**（ISSUE #3102）。
 *
 * ## 它治的形态（用户截图的现场）
 *
 * Actions 界面上只能看到 `✗ 分支守卫（cnb 同款判据一字不改）` 与
 * `Process completed with exit code 1` —— 红的原因藏在折叠的日志里，要展开、翻页、
 * 自己认哪一行是判决。`[重档] 合计：红 0、没判 12、判过 49` 那一段同理：job 红，
 * 界面只给一句 exit code 2，而「没判」与「判出失败」在界面上**长得一模一样**。
 *
 * 所以这一层做三件事（都在 GitHub 上，本地与 CNB 不需要它）：
 *
 *   · **注解**：把首条原因压进 `::error::` / `::warning::`，折叠状态就能读到；
 *   · **Job Summary**：写进 `$GITHUB_STEP_SUMMARY` —— 界面上步骤页那一块「Summary」，
 *     含退出码、首条原因、命中行与末尾若干行，不用翻长日志；
 *   · **三态的退出码折算**：子进程退 2（本仓的「没判」）且**自己打了不判标记**时，
 *     折成 0 —— 这一步于是不以红收场；其余非零一律原样透出（红照样红）。
 *
 * ## 为什么折算要认标记，而不是「见到 2 就放过」
 *
 * 本仓 exit 2 同时被两种语义用过：`premerge-check.mjs` 的「没跑起来」（127 那档也
 * 走 2，见 `ci-heavy-gates.mjs` 的 `missing`）与聚合层的「没判」。**无条件把 2 折成 0
 * 会把「判据根本没跑起来」读成绿** —— 那正是本仓最不能有的形态（§12.12）。
 * 所以只在子进程**逐字打出了**那段「不判」结论时才折算：标记是子进程写的，
 * 不是外壳猜的；PR 形态下子进程不会打它，红就仍然是红。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不改判据**：退出码来源仍是子进程，本层只在 0 / 2+标记 两档上做界面换算；
 *   · **不用 `continue-on-error`**：那会把真实失败也一并吞成绿，判据强度当场掉档；
 *   · **不缓存全量输出**：只留「头 5 行 + 尾 200 行」，摘要里给的是证据而不是全文
 *     （全文本来就在同一份日志里，本层不重复搬运）。
 *
 * ## 用法
 *
 *   node scripts/ci-step-verdict.mjs --label "<步骤名>" \
 *     [--inconclusive-marker "<不判标记>"] -- <命令> [参数...]
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

/** 本仓的「没判」退出码（与 `premerge-check.mjs` / `ci-heavy-gates.mjs` 同源口径）。 */
export const INCONCLUSIVE_CODE = 2;

/** 摘要里最多列几条「命中行」（再多就该点进日志了）。 */
const MAX_REASON_LINES = 8;

/** 尾部保留行数（`[红]` 那一段常常在最后几屏，取够一段上下文）。 */
const TAIL_LINES = 200;

/** ANSI 着色剥离（`ci-heavy-gates.mjs` 的 `log()` 带色）。用 `String.fromCharCode(27)`
 * 拼正则：源码里写不出那个控制字符（`no-control-regex` 连转义写法也拦）。 */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * 解析 CLI 参数（`--` 之后全是子命令，一个字都不动）。
 *
 * @param {string[]} argv
 * @returns {{label: string, marker: string | null, cmd: string[]}}
 */
export function parseCli(argv) {
  let label = "";
  let marker = null;
  const cmd = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      cmd.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--label") {
      label = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--inconclusive-marker") {
      marker = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    throw new Error(`认不出的参数 "${arg}"（只认 --label / --inconclusive-marker / --）`);
  }
  return { label, marker, cmd };
}

/**
 * 退出码折算：**只有**「2 + 子进程自己打了不判标记」这一档折成 0。
 *
 * @param {number | null} code 子进程退出码（被信号终止时为 null）
 * @param {boolean} markerHit 子进程输出里是否出现那个标记
 * @returns {{code: number, inconclusive: boolean}}
 */
export function mapExit(code, markerHit) {
  const raw = code ?? 1;
  if (raw === INCONCLUSIVE_CODE && markerHit) {
    return { code: 0, inconclusive: true };
  }
  return { code: raw === 0 ? 0 : raw, inconclusive: false };
}

/**
 * 从输出里挑「为什么」的几行：三态判决行、阻断/错误行优先，其余按尾部补齐。
 *
 * 按**位置与形状**挑，不按词表猜语义 —— 词的清单只用来**排序**，不用来断言
 * （`[红]` 与 `阻断` 是本仓固定写法，`Error:` 是 git / node 的原话）。
 *
 * @param {string[]} lines 已去色、去空行的行
 * @returns {string[]}
 */
export function pickReasonLines(lines) {
  const shaped = lines.filter((line) =>
    /^\[红\]|^\[skip\]|阻断|不判|Error:|::error|exit code|合计：红|[×✗]/.test(line.trim()),
  );
  const picked = shaped.length > 0 ? shaped : lines;
  return picked.slice(-MAX_REASON_LINES);
}

/**
 * 渲染 Job Summary（Markdown）。纯函数：让用例能逐字判，不必真跑子进程。
 *
 * @param {object} verdict
 * @param {string} verdict.label 步骤名
 * @param {number} verdict.code 折算后的退出码（0 = 不红）
 * @param {number} verdict.rawCode 子进程原始退出码
 * @param {boolean} verdict.inconclusive 是否走了「不判」折算
 * @param {string[]} verdict.lines 输出行（未去色亦可，这里只做排版）
 * @returns {string}
 */
export function renderSummary({ label, code, rawCode, inconclusive, lines }) {
  const clean = (lines ?? []).map((line) => String(line ?? "").replaceAll(ANSI_ESCAPE, ""));
  const reasons = pickReasonLines(clean);
  const head = inconclusive
    ? `### ${label} — 没判（退出码 ${rawCode}，按没判不按红）`
    : code === 0
      ? `### ${label} — 通过`
      : `### ${label} — 红（退出码 ${rawCode}）`;
  const body = [
    head,
    "",
    inconclusive
      ? "> 这一步**没有作出判决**（不是通过）。折算成非红只针对「前提在本次触发形态下不存在」那一档，PR 形态下同一判据仍会红。"
      : code === 0
        ? "> 判据给了结论：通过。"
        : "> 首条原因见下面的「命中行」；完整输出在同一份日志里。",
    "",
  ];
  if (reasons.length > 0) {
    body.push("**命中行**", "", "```", ...reasons, "```", "");
  }
  const tail = clean.filter((line) => line.trim()).slice(-15);
  if (code !== 0 || inconclusive) {
    body.push("**末尾 15 行**", "", "```", ...tail, "```", "");
  }
  return body.join("\n");
}

/**
 * GitHub 注解的数据段转义（`%` → `%25`，换行 → `%0A`，回车 → `%0D`）。
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeAnnotation(text) {
  return String(text ?? "")
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/**
 * 写 Job Summary（没有 `$GITHUB_STEP_SUMMARY` 时静默跳过 —— 本地 / CNB 无此变量）。
 *
 * @param {string} markdown
 * @param {Record<string, string | undefined>} [env]
 */
export function appendSummary(markdown, env = process.env) {
  const path = env.GITHUB_STEP_SUMMARY;
  if (!path) {
    return;
  }
  appendFileSync(path, `${markdown}\n`);
}

/**
 * 跑子命令：输出**边跑边转出**（界面日志照旧逐行长），只在内存留尾部若干行。
 *
 * @param {string[]} cmd
 * @returns {Promise<{code: number | null, lines: string[]}>}
 */
function runChild(cmd) {
  return new Promise((resolve, reject) => {
    /** @type {import("node:child_process").StdioOptions} */
    const stdio = ["inherit", "pipe", "pipe"];
    const child = /** @type {import("node:child_process").ChildProcess} */ (
      spawn(/** @type {string} */ (cmd[0]), cmd.slice(1), { stdio })
    );
    /** @type {string[]} */
    const lines = [];
    /**
     * @param {string | Buffer} chunk
     */
    const forward = (chunk) => {
      process.stdout.write(chunk);
      for (const line of String(chunk).split("\n")) {
        if (line.trim() === "") {
          continue;
        }
        lines.push(line);
        if (lines.length > TAIL_LINES) {
          lines.shift();
        }
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, lines });
    });
  });
}

async function main() {
  const { label, marker, cmd } = parseCli(process.argv.slice(2));
  if (cmd.length === 0) {
    console.error(
      "用法：node scripts/ci-step-verdict.mjs --label <名> [--inconclusive-marker <标记>] -- <命令...>",
    );
    return 3;
  }
  const { code, lines } = await runChild(cmd);
  const markerHit = marker !== null && lines.some((line) => line.includes(marker));
  const verdict = mapExit(code, markerHit);
  const reasons = pickReasonLines(lines);
  const summary = renderSummary({
    label,
    code: verdict.code,
    rawCode: code ?? 1,
    inconclusive: verdict.inconclusive,
    lines,
  });
  appendSummary(summary);
  if (verdict.inconclusive) {
    console.log(
      `::warning::${escapeAnnotation(`${label} 不判（退出码 ${code}）：${reasons.at(-1) ?? "见日志"}`)}`,
    );
    return 0;
  }
  if (verdict.code !== 0) {
    console.log(
      `::error::${escapeAnnotation(`${label} 红（退出码 ${code}）：${reasons.at(-1) ?? "见日志"}`)}`,
    );
    return verdict.code;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`[step-verdict] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 3;
  }
}
