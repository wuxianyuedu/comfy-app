#!/usr/bin/env node
/**
 * session-report.mjs — 一次开发批次的**汇报骨架**生成器（§12.20 / ISSUE #3165）。
 *
 * ── 它回答的那个问句 ─────────────────────────────────────────────────────
 *
 * 一次批次做完后要向其他人汇报：做了什么（新增这些）、验证哪步执行**消耗多少时间**、
 * 开发总结、值得记录的经验与可复用的东西、哪些事项还要提单。这五节此前没有本仓自己的
 * 形状 —— 验证段是手写的一句话（哪步跑了、各花几秒，一个数都没有），待办靠现场翻
 * 平台单列表。本工具把**机器能填的两节**填掉（做了什么 + 验证读数），把**判断的三节**
 * 留成人填的骨架（总结 / 经验 / 待办）—— 事实机器填、判断人填，是本仓一贯的分界。
 *
 * ── 入口只编排，不发明第二套判定（§12.20 那条铁律）──────────────────────
 *
 * 验证批的每一步都是**既有执行者的原值**（`check-file-structure` /
 * `check-infra-file-size` / …），本工具只做两件事：逐条**计时**、把退码与输出末尾
 * **完整转述** —— 转述型工具把 stderr 丢掉是这一族最重的事故（§12.20）。红的步骤
 * 单独点名，总墙钟照报；「全过」这个词只在 8/8 全绿时才出现。
 *
 * 「本次」的边界由 `--range <A>..<B>` 显式给（与 `check-reformat-only` 同一口径，
 * 区间解析复用 `reformat-scan-core.mjs` 的 `parseRange`）—— 工具不猜会话边界。
 *
 * ── 它不是门禁 ───────────────────────────────────────────────────────────
 *
 * 生成的是**汇报文件**，不写平台、不立案（立案是人点名 `pnpm ship --new-issue`，
 * 退出码只有「参数读不出 / 没跑起来」才非零）。它也不进 GATES / 按需档两本账 ——
 * 那两本记的是**档**（有没有人执行），本工具是读账面工具，发现面在 §12.20 的标本段
 * 与动词本身（与 `precommit-timing.mjs` 的读账出口同一登记面决策，ISSUE #2769）。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────────
 *
 *   pnpm report:session --range <A>..<B>            # 标准验证批 + 区间内提交
 *   pnpm report:session --range A..B --steps-file <path>   # 自定义验证批（JSON）
 *
 * @module scripts/session-report — 会话汇报骨架（编排 + 计时，判定全归既有执行者）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { parseRange } from "./reformat-scan-core.mjs";

/** 默认验证批 —— 每一步都是**既有执行者**，本工具只编排 + 计时（§12.20）。
 *  顺序按「便宜在前、最贵收尾」，读的人先看到快的都绿了。 */
const DEFAULT_STEPS = [
  { label: "文件结构硬规则", argv: ["node", "scripts/check-file-structure.cjs"] },
  { label: "infra 尺寸（scripts+tools ≤900 行）", argv: ["node", "scripts/check-infra-file-size.cjs"] },
  { label: "函数长度", argv: ["node", "scripts/check-function-length.cjs"] },
  { label: "changelog 碎片形态", argv: ["node", "scripts/check-changelog-fragments.cjs"] },
  { label: "CP936 字形登记", argv: ["node", "scripts/check-cp936-glyphs.cjs"] },
  { label: "已清零 oxlint 规则集", argv: ["node", "scripts/check-oxlint-zero-rules.mjs"] },
  { label: "脚本档类型检查（.mjs 全量面棘轮）", argv: ["node", "scripts/check-scripts-typecheck.cjs"] },
  { label: "文档引用与权威源一致", argv: ["node", "scripts/check-doc-references.cjs"] },
];

/**
 * @param {number} ms
 * @returns {string}
 */
function secs(ms) {
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

/**
 * git 取数（cwd 绑定 + 失败回 `null` —— 「没读到」与「空」分开，
 * 与 `merged-side-loss-git.mjs` 的 `runGit` 同一形）。
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string | null}
 */
function runGit(cwd, args) {
  try {
    return spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).stdout?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * 区间内的提交清单（「本次做了什么」的事实段）。
 *
 * PR 号取自 squash 合并标题尾部的 `(#N)`（本仓 squash 的固定形状）；
 * 变更面取自 `--numstat`（二进制行的 `-` 记 0，只计份数）。
 *
 * @param {string} cwd 被汇报的仓库
 * @param {{before: string, after: string}} range 已解析的区间端点
 * @returns {Array<{sha: string, subject: string, pr: string, files: number, ins: number, del: number}> | null}
 *   取不到（区间解析不了 / 不在 git 检出）给 `null`
 */
export function collectCommits(cwd, range) {
  const raw = runGit(cwd, [
    "-c",
    "core.quotePath=false",
    "log",
    "--numstat",
    `--pretty=format:%x01%H%x1f%s%x1e`,
    `${range.before}..${range.after}`,
  ]);
  if (raw === null) {
    return null;
  }
  /** @type {Array<{sha: string, subject: string, pr: string, files: number, ins: number, del: number}>} */
  const out = [];
  for (const chunk of raw.split("\u0001")) {
    const text = chunk.trim();
    if (!text) {
      continue;
    }
    const [head = "", ...body] = text.split("\u001e");
    const [sha = "", subject = ""] = head.split("\u001f");
    if (!sha) {
      continue;
    }
    let files = 0;
    let ins = 0;
    let del = 0;
    for (const line of (body[0] ?? "").split("\n")) {
      const m = /^(?<ins>\d+|-)\t(?<del>\d+|-)\t(?<rest>.+)$/.exec(line.trim());
      if (!m) {
        continue;
      }
      files += 1;
      ins += m.groups?.ins === "-" ? 0 : Number(m.groups?.ins);
      del += m.groups?.del === "-" ? 0 : Number(m.groups?.del);
    }
    /* squash 标题尾部的 `(#N)` 是本仓的落地行形状；裸 `#N`（引用，不是认领）不算 ——
     * 与 ship 关单那一条同一把尺（ISSUE #2646）。 */
    const pr = /(?:\(#(?<prNo>\d+)\)\s*)$/.exec(subject)?.groups?.prNo ?? "";
    out.push({ sha, subject, pr, files, ins, del });
  }
  return out;
}

/**
 * 跑一批验证步骤：逐条**计时**、退码与输出末尾**完整转述**（§12.20 那条铁律：
 * 编排既有执行者，不发明第二套判定；效应不许只转述 stdout）。
 *
 * @param {Array<{label: string, argv: string[]}>} steps
 * @param {{cwd?: string, runner?: (argv: string[], cwd: string) => {status: number | null, stdout?: string, stderr?: string, error?: unknown}}} [opts]
 *   `runner` 给用例注入（不真起子进程）；缺省 `spawnSync`，命令失败（起不来）按
 *   「没跑起来」记退码 -1 —— 与 base-check 的 127 那一档同一条边界。
 * @returns {{results: Array<{label: string, argv: string, ms: number, code: number, tail: string}>, totalMs: number}}
 */
export function runSteps(steps, opts = {}) {
  /** @type {{cwd?: string, runner?: (argv: string[], cwd: string) => {status: number | null, stdout?: string, stderr?: string, error?: unknown}}} */
  const o = opts ?? {};
  const cwd = o.cwd ?? process.cwd();
  /** @type {(argv: string[], dir: string) => {status: number | null, stdout?: string, stderr?: string, error?: unknown}} */
  const runner =
    o.runner ??
    ((argv, dir) => {
      /* noUncheckedIndexedAccess 下 `argv[0]` 是 `string | undefined`；真给空数组时
       * 命令按空串起（spawnSync 报 ENOENT ⇒ status null ⇒ 那一步按「没跑起来」记）。 */
      const cmd = argv[0] ?? "";
      return spawnSync(cmd, argv.slice(1), {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    });
  /** @type {Array<{label: string, argv: string, ms: number, code: number, tail: string}>} */
  const results = [];
  const t0 = performance.now();
  for (const step of steps) {
    const s0 = performance.now();
    const r = runner(step.argv, cwd);
    const ms = performance.now() - s0;
    const code = r?.status ?? -1;
    const out = `${r?.stdout ?? ""}\n${r?.stderr ?? ""}`.trimEnd();
    const lines = out.split("\n").filter(Boolean);
    results.push({
      label: step.label,
      argv: step.argv.join(" "),
      ms,
      code,
      tail: lines.slice(-8).join("\n"),
    });
  }
  return { results, totalMs: performance.now() - t0 };
}

/**
 * 汇报骨架（markdown，stdout 交给人贴走）。三节判断段（总结 / 经验 / 待办）只给
 * 骨架与填法提示 —— 事实机器填、判断人填。
 *
 * @param {{
 *   range: {before: string, after: string},
 *   commits: Array<{sha: string, subject: string, pr: string, files: number, ins: number, del: number}> | null,
 *   steps: {results: Array<{label: string, argv: string, ms: number, code: number, tail: string}>, totalMs: number},
 * }} input
 * @returns {string}
 */
export function formatReport(input) {
  const { range, commits, steps } = input;
  const { results, totalMs } = steps;
  const lines = [
    `# 开发汇报（${range.before.slice(0, 8)}..${range.after.slice(0, 8)}）`,
    "",
    "## 一、本次做了什么（新增/变更清单）",
    "",
  ];
  if (commits === null) {
    lines.push("（区间取不到 —— 不在 git 检出，或端点解析不了。这份汇报没有提交事实可填。）");
  } else if (commits.length === 0) {
    lines.push("（区间里没有提交 —— 「本次」的边界给错了，换 `--range` 再来一次。）");
  } else {
    for (const c of commits) {
      lines.push(
        `- \`${c.sha.slice(0, 8)}\` ${c.subject}${c.pr ? ` —— PR #${c.pr}` : ""}` +
          `（${c.files} 份文件，+${c.ins} −${c.del}）`,
      );
    }
    lines.push("");
    lines.push("（上面是机器事实；每条**新增了什么**的一句话由人补在这里。）");
  }
  const greens = results.filter((r) => r.code === 0).length;
  const reds = results.filter((r) => r.code !== 0);
  lines.push("");
  lines.push("## 二、验证读数（哪步执行 · 消耗多少时间）");
  lines.push("");
  lines.push("| # | 步骤 | 耗时 | 退码 |");
  lines.push("| --- | --- | --- | --- |");
  results.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.label} | ${secs(r.ms)} | ${r.code} |`);
  });
  lines.push("");
  lines.push(
    `（总墙钟 ${secs(totalMs)} · 绿 ${greens}/${results.length}` +
      `${reds.length > 0 ? " —— **红的在下面点名，不许写成「全过」**" : " —— 全过"}）`,
  );
  if (reds.length > 0) {
    lines.push("");
    lines.push("### 红的步骤");
    lines.push("");
    for (const r of reds) {
      lines.push(`- [红] ${r.label}（${secs(r.ms)}，退码 ${r.code}）—— 输出末尾：`);
      lines.push("  ```");
      for (const l of r.tail.split("\n")) {
        lines.push(`  ${l}`);
      }
      lines.push("  ```");
    }
  }
  lines.push("");
  lines.push("## 三、开发总结");
  lines.push("");
  lines.push("<!-- 人填：这一轮做了什么、关键取舍与因果（事实在第一节，这里是判断）。 -->");
  lines.push("");
  lines.push("## 四、经验与可复用");
  lines.push("");
  lines.push(
    "<!-- 人填：值得记录的经验、可复用的东西；沉淀去向（规范条目 / 工具 / 单子）——" +
      "只留在汇报里、仓库里没有 = 下一个人一定重犯（§12.20）。 -->",
  );
  lines.push("");
  lines.push("## 五、待处理（需要提单的）");
  lines.push("");
  lines.push(
    "<!-- 人填：还没立案的事项，逐条按下面的命令形状立案（立案动作归 ship，本工具不写平台）：\n" +
      "pnpm ship --new-issue \"<标题>\" --issue-body-file <正文> --priority P0|P1|P2|P3 -->",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/** 用法那一行（退 2 时打印）。 */
const USAGE =
  "用法：pnpm report:session --range <A>..<B> [--steps-file <path>] —— " +
  "「本次」的边界必须显式给（工具不猜）。\n";

/**
 * @param {string[]} argv
 * @param {string} [cwd]
 * @returns {number} 0 = 汇报已产出；2 = 参数读不出 / 没跑起来（不是「红」，是没结论）
 */
export function main(argv, cwd = process.cwd()) {
  /** @param {string} name */
  const valueOf = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const rangeRaw = valueOf("--range");
  if (!rangeRaw) {
    process.stderr.write(USAGE);
    return 2;
  }
  const range = parseRange(rangeRaw);
  if (!range) {
    process.stderr.write(`[session-report] --range 解析不了：${rangeRaw}\n${USAGE}`);
    return 2;
  }
  let steps = DEFAULT_STEPS;
  const stepsFile = valueOf("--steps-file");
  if (stepsFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.resolve(cwd, stepsFile), "utf8"));
      if (!Array.isArray(parsed.steps)) {
        throw new Error("缺 steps 数组");
      }
      steps = parsed.steps;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      process.stderr.write(
        `[session-report] --steps-file 读不出（${e.message}）—— 不冒充「跑过标准批」。\n`,
      );
      return 2;
    }
  }
  const commits = collectCommits(cwd, range);
  const stepsRun = runSteps(steps, { cwd });
  process.stdout.write(formatReport({ range, commits, steps: stepsRun }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
