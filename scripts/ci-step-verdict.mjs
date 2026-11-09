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

/** 摘要里「末尾若干行」那一段的行数。
 *
 * 与 `TAIL_LINES` 是两件事：后者是**内存里**留多少行供挑原因，前者是**写进摘要**
 * 多少行给人看。混用会让摘要里出现两百行终端噪声（那正是「摘要乱糟糟」之一）。
 * 15 行是按「够读到一段结论 + 一两行上文」定的。 */
const TAIL_LINES_IN_SUMMARY = 15;

/** ANSI 着色剥离（`ci-heavy-gates.mjs` 的 `log()` 带色）。用 `String.fromCharCode(27)`
 * 拼正则：源码里写不出那个控制字符（`no-control-regex` 连转义写法也拦）。 */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * 解析 CLI 参数（`--` 之后全是子命令，一个字都不动）。
 *
 * @param {string[]} argv
 * @returns {{label: string, marker: string | null, cmd: string[], summaryTitle: string | null}}
 */
export function parseCli(argv) {
  let label = "";
  let marker = null;
  let summaryTitle = null;
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
    if (arg === "--summary-title") {
      summaryTitle = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    throw new Error(
      `认不出的参数 "${arg}"（只认 --label / --inconclusive-marker / --summary-title / --）`,
    );
  }
  return { label, marker, cmd, summaryTitle };
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
 * 渲染**一段**判据（Markdown）。纯函数：让用例能逐字判，不必真跑子进程。
 *
 * 版式口径（2026-11-09 对齐 GA 摘要实测乱象）：
 *   · 标题只到 `###`，`##` 留给 `renderJobSummary()` 的总览 —— 一段一个 `##`
 *     会让摘要变成一串平级大标题，读者看不出「谁包着谁」；
 *   · **「末尾若干行」只在它真的带来新信息时才出现**。此前无条件输出，而
 *     `pickReasonLines()` 在输出很短时取的就是全部行 ⇒ 「命中行」与「末尾 15 行」
 *     是同一段文字复制两遍（GA 页上逐字可见）。判据是**内容差**，不是行数。
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
  const tone = inconclusive ? "没判" : code === 0 ? "通过" : "红";
  const head = `### ${stateIcon(tone)} ${label} — ${stateText(tone, rawCode)}`;
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
  /* 「命中行」只在它带来证据时才给：通过的那一格没有失败行可读，
     把一行 `ok` 印成代码块是占位，不是信息（GA 页上那类「同一段话出现两遍」的近亲）。 */
  if (reasons.length > 0 && (code !== 0 || inconclusive)) {
    body.push("**命中行**", "", "```text", ...reasons, "```", "");
  }
  /* 末尾若干行只在「命中行之外还有别的可读内容」时给 —— 否则就是同一段话说两遍。 */
  const tail = clean.filter((line) => line.trim()).slice(-TAIL_LINES_IN_SUMMARY);
  const extra = tail.filter((line) => !reasons.includes(line.trim()));
  if (extra.length > 0 && (code !== 0 || inconclusive)) {
    body.push(`**末尾 ${TAIL_LINES_IN_SUMMARY} 行**`, "", "```text", ...tail, "```", "");
  }
  return body.join("\n");
}

/** 三态在摘要里的图标（`没判` 刻意不是 ❌ —— 它不是红，也不是通过）。
 *
 * @param {string} tone
 */
function stateIcon(tone) {
  return tone === "通过" ? "✅" : tone === "没判" ? "⚠️" : "❌";
}

/** 三态的标题后缀（退出码只在非通过时才有意义）。
 *
 * @param {string} tone
 * @param {number} rawCode
 */
function stateText(tone, rawCode) {
  if (tone === "通过") {
    return "通过";
  }
  if (tone === "没判") {
    return `没判（退出码 ${rawCode}，按没判不按红）`;
  }
  return `红（退出码 ${rawCode}）`;
}

/**
 * 把**这一步跑的每一格**聚合成一页 Job Summary。
 *
 * 为什么需要这一层：`ci-step-verdict.mjs` 一次只包一格，而一个 job 里可能包多格
 * （`.cnb.yml` 与 `pr-gate.yml` 都有这样的 job）。逐格 `###` 平铺时，读者要滚完
 * 每一段才知道「这次到底红没红、红在哪几格」—— 结论行以及（多格时）那张总览表
 * 就是回答这一问的位置。**汇总层不重新判**：三态全部来自各格的同一份读数。
 *
 * 两档形态，按格数切换（不是两个渲染器）：
 *   · **一格** ⇒ 只要一行结论 + 那一段正文。一张只有一行的表没有任何信息量，
 *     反而把正文推下去 —— 这是「摘要乱糟糟」里最不值的那一层。
 *   · **多格** ⇒ 结论行 + 一张总览表 + 各段正文。表的价值只在它能横向对比时成立。
 *
 * 空数组 ⇒ 空串（不写一个空壳标题出来）。
 *
 * @param {Array<{label: string, code: number, rawCode: number, inconclusive: boolean, lines: string[]}>} verdicts
 * @param {{title?: string}} [opt]
 * @returns {string}
 */
export function renderJobSummary(verdicts, opt = {}) {
  if (verdicts.length === 0) {
    return "";
  }
  const rows = verdicts.map((v) => {
    const tone = v.inconclusive ? "没判" : v.code === 0 ? "通过" : "红";
    return {
      icon: stateIcon(tone),
      label: v.label,
      tone,
      detail: tone === "通过" ? "—" : `退出码 ${v.rawCode}`,
    };
  });
  /** @param {string} t */
  const count = (t) => rows.filter((r) => r.tone === t).length;
  const title = opt.title ?? "本 step 判据";
  /* 结论行按「有红先报红」排：一条红压过所有没判 —— 第一行就该是读者要的那一句。 */
  const red = count("红");
  const warn = count("没判");
  const headline =
    red > 0
      ? `❌ **${red} 格红**${warn > 0 ? ` · ⚠️ ${warn} 格没判` : ""} · ✅ ${count("通过")} 格通过`
      : warn > 0
        ? `⚠️ **${warn} 格没判**（不是通过）· ✅ ${count("通过")} 格通过`
        : `✅ **全部通过**（${count("通过")} 格）`;
  const lines = [`## ${title}：${headline}`, ""];
  if (rows.length > 1) {
    lines.push(
      "| 结论 | 格 | 读数 |",
      "| --- | --- | --- |",
      ...rows.map((r) => `| ${r.icon} ${r.tone} | ${r.label} | ${r.detail} |`),
      "",
    );
  }
  for (const v of verdicts) {
    lines.push(renderSummary(v), "");
  }
  return lines.join("\n");
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
  const { label, marker, cmd, summaryTitle } = parseCli(process.argv.slice(2));
  if (cmd.length === 0) {
    console.error(
      "用法：node scripts/ci-step-verdict.mjs --label <名> [--inconclusive-marker <标记>] [--summary-title <页标题>] -- <命令...>",
    );
    return 3;
  }
  const { code, lines } = await runChild(cmd);
  const markerHit = marker !== null && lines.some((line) => line.includes(marker));
  const verdict = mapExit(code, markerHit);
  const reasons = pickReasonLines(lines);
  const entry = {
    code: verdict.code,
    inconclusive: verdict.inconclusive,
    label,
    lines,
    rawCode: code ?? 1,
  };
  /* 一次调用 = 一页摘要（总览表 + 这一段）。此前这里直接追加 `renderSummary()`，
   * 于是同一 job 里包几格、摘要就平铺几段 `###`，没有任何总览。 */
  appendSummary(renderJobSummary([entry], { title: summaryTitle ?? undefined }));
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
