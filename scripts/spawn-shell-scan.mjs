#!/usr/bin/env node
/**
 * spawn-shell-scan.mjs — 守「**起子进程不许开 shell**」这一条（ISSUE #2453 / #2445）。
 *
 * ── 为什么要有这个脚本 ────────────────────────────────────────────────────
 *
 * `node_modules/.bin/<工具>` 是给宿主 shell 用的垫片，Node 直起它 `EINVAL` ⇒ 于是有人
 * 给 `spawn` / `spawnSync` 加一句 `shell: true`。那一条同时带来两件事：
 *
 *   ① Node 26 把它标成 **DEP0190** 弃用（「args 数组 + 开 shell」）；
 *   ② 开了 shell 之后 Node **不给参数转义**，含空格的路径要自己括引号 ——
 *      括漏了就是「换台机器跑不起来」，而它不报错、只是 quietly 跑错。
 *
 * ISSUE #2445 修掉了 typedoc 那一处（改成 `spawn(process.execPath, [包真身入口, …])`），
 * 而**第二处**（`scripts/storybook.mjs`）是靠 grep 肉眼找到的 —— 这正说明缺一条判据：
 * 「第三处还会长出来」这件事，靠人记得不如靠机器念。
 *
 * ── 它判什么 ──────────────────────────────────────────────────────────────
 *
 * `scripts/**` 下的 `.mjs` / `.cjs` 里，**剥掉注释之后**不许再出现
 * 「`spawn` / `spawnSync` / `execFile` / `execFileSync` 那类调用的选项对象里带 shell」
 * 的形状。剥注释这一步不是可选的：仓里有四份文件在**注释里**写着「不要开 shell / 开 shell
 * 是错的形态」（`hook-steps` / `ci-install-deps` / `e2e-run` / `ship-exec`）—— 不剥就会把
 * 「正在教人别这么写」的那一句判成违例，而那会让人学会的第一件事就是给判据加白名单。
 *
 * 刻意**不做**的事：
 *   · 不判「该不该起这个进程」（那是各调用方的事）；
 *   · 不做 AST（正则 + 剥注释对本仓这批扁平的选项对象足够，而 AST 会把这份判据钉在
 *     某个 parser 版本上）；
 *   · 不扫 `src/**`（那一侧的进程动作归硬规则 3 的 `kill-process-tree` 那一族，另有判据）。
 *
 * 用法：
 *   node scripts/spawn-shell-scan.mjs            # 人读报告，有违例即非零退出
 *   node scripts/spawn-shell-scan.mjs --json     # 机器读（供契约测试）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 违例形状：`shell:` 且值**不是**「明确不开」的那几种。
 *
 * 为什么排除 `shell: false` / `null` / `undefined` / 字符串值：
 *   · `shell: false` 是**显式**关掉（本仓 `launcher-core/shell.mjs` 有四处这么写），
 *     它不是弃用形态，判它就是把「写清楚的人」和「没写的人」一起罚；
 *   · 字符串值那一族（`log.mjs` 的 `shell: "shell"` 是日志分类）与进程无关。
 * 于是留下来的正是要拦的那三种：`shell: true`、`shell: process.platform === "win32"`、
 * `shell: needsShell(cmd)`。
 */
/* ⚠️ 空白要在**预查里面**（`\s*` 放在预查前面时，正则会回溯到「不吃空白」那一步，
 * 于是 `(?!false)` 永远成立 —— 那是一句**什么都不排**的排除，写它的人以为排掉了）。
 * 把 `\s*` 挪进预查之后，`shell: false` 才会真的被排掉。 */
const SHELL_OPTION_RE = /\bshell\s*:(?!\s*(?:false\b|null\b|undefined\b|["'`]))/;

/**
 * 剥掉注释（行注释 / 块注释），保留字符串里同形的那些字符。
 *
 * 为什么要认真剥：`scripts/ci-install-deps.mjs` 那几份文件的注释里写着
 * 「自己拼 spawnSync(…, { 开 shell }) 是错的形态」—— 那句话是在**教人别这么写**，
 * 把它判成违例是判据自己没读懂源码，代价是下一次有人给判据加白名单、从此什么也拦不住。
 *
 * **为什么逐行、且每行重置引号状态**（这一条是踩出来的）：第一版写成了「整个文件一个
 * 状态机」，结果 `base-check/hook-steps.mjs` 里一处游离的引号把它卡在「单引号字符串」
 * 状态里再也出不来 —— 之后几百行**全被当成字符串**，块注释也不再被认，判据报出一堆
 * 注释里的假违例。整文件状态机的失效形态是**跑飞且无声**（它不报错，只是少读了内容），
 * 而本模块要治的那一族正是「少读 ⇒ 漏判」。逐行之后，一处游离引号最多毁掉**一行**，
 * 块注释用跨行的 `inBlock` 单独跟踪 —— 那才是注释真正的跨行形态。
 *
 * 边界（如实写）：不识别正则字面量；模板串里的 `${}` 当字符串内容处理。
 * 本仓这批脚本没有这两种写法；真出现了，毁掉的也只是那一行。
 *
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  /** @type {string[]} */
  const out = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    /** @type {string[]} */
    const kept = [];
    /** @type {null | "'" | '"' | "`" } */
    let quote = null;
    let i = 0;
    while (i < line.length) {
      /* `?? ""`：索引访问在 `noUncheckedIndexedAccess` 下是 `string | undefined`，
       * 而这里 `i < line.length` 已经保证了它存在 —— 用空串兜住类型面，
       * 不靠 `!`（本仓 src 侧禁 `!`，脚本侧同口径）。 */
      const c = line[i] ?? "";
      const two = line.slice(i, i + 2);
      if (inBlock) {
        if (two === "*/") {
          inBlock = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (quote !== null) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        kept.push(c);
        i += 1;
        continue;
      }
      if (two === "//") break; // 行注释：这一行到此为止
      if (two === "/*") {
        inBlock = true;
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        quote = c;
        kept.push(c);
        i += 1;
        continue;
      }
      kept.push(c);
      i += 1;
    }
    out.push(kept.join(""));
  }
  return out.join("\n");
}

/**
 * 递归收集 `scripts/**` 下的 .mjs / .cjs（跳过 node_modules）。
 *
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      collect(full, out);
      continue;
    }
    if (name.endsWith(".mjs") || name.endsWith(".cjs")) out.push(full);
  }
  return out;
}

/**
 * 扫一遍，给出违例清单。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]} `文件:行号: 原文` 形态
 */
export function findShellOptions(root = ROOT) {
  /** @type {string[]} */
  const offenders = [];
  for (const file of collect(path.join(root, "scripts"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const stripped = stripComments(fs.readFileSync(file, "utf8"));
    stripped.split("\n").forEach((line, idx) => {
      if (SHELL_OPTION_RE.test(line)) offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
    });
  }
  return offenders;
}

/* 直接执行时给人读的报告（`node scripts/spawn-shell-scan.mjs`）。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const offenders = findShellOptions();
  if (offenders.length > 0) {
    process.stderr.write(
      "[spawn-shell-scan] scripts/** 出现「起子进程开 shell」的形态" +
        "（Node 26 的 DEP0190，且开了 shell 参数要自己括引号）—— 改用" +
        "`spawn(process.execPath, [resolvePackageBinEntry(pkg), …])` 直起包真身：\n",
    );
    for (const o of offenders) process.stderr.write(`  ${o}\n`);
    process.exit(1);
  }
  const msg = "[spawn-shell-scan] OK：scripts/** 里没有开 shell 起子进程的形态";
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: true, offenders: [] }));
  } else {
    process.stdout.write(msg + "\n");
  }
}
