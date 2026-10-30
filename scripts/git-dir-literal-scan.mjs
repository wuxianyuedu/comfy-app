#!/usr/bin/env node
/**
 * git-dir-literal-scan.mjs — 守「检出目录在哪」只有 `scripts/git-dir.mjs` 一处知道
 * （ISSUE #2072）。
 *
 * 为什么要有这个脚本：本仓曾经在四处各自 `path.join(root, 检出子目录, …)` 硬拼检出
 * 位置（`shell-gate` / `ci-workspace-probe` / `launcher-core/run` /
 * `check-deps-freshness`），而链接工作树里 `.git` 是个**文件**，硬拼指向它 ——
 * MERGE_HEAD / HEAD / FETCH_HEAD 永远查不到。修复把它们统一收口到 `git-dir.mjs` 的
 * `resolveGitDir`；这条判据防止下一次有人又顺手拼一个回去。
 *
 * 要点：`scripts/**` 里除了 `scripts/git-dir.mjs` 之外，**不许**出现引号包住的
 * 检出子目录字面量（路径拼接形态）。白名单只放 `git-dir.mjs` 自己。
 *
 * 用法：
 *   node scripts/git-dir-literal-scan.mjs            # 人读报告，有违例即非零退出
 *   node scripts/git-dir-literal-scan.mjs --json     # 机器读（供契约测试）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");
// 白名单只放 git-dir.mjs 自己（规范 §13.5.x）。用正斜杠，跨平台与 rel 归一一致。
const WHITELIST = new Set(["scripts/git-dir.mjs"]);
// needle 用拼接构造，避免本脚本源码里出现引号包住的检出子目录字面量而被自己命中。
const needle = "." + "git";
const re = new RegExp("[\"']" + needle.replace(".", "\\.") + "[\"']");

/**
 * 递归收集 `scripts/**` 下的 `.mjs` 文件（跳过 `node_modules`）。
 * @param {string} dir 起点目录（绝对路径）
 * @param {string[]} [out] 累加用的收集器 —— 递归各层共用**同一个数组**，
 *   所以返回值就是最初那次调用传进来的那一份（不写类型时默认值是 `never[]`，
 *   下面 `out.push(full)` 会报「推不进去」）
 * @returns {string[]} 收集到的文件绝对路径
 */
function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") {
        continue;
      }
      collect(full, out);
      continue;
    }
    if (name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 命中清单：`相对路径:行号: 那一行的原文`。
 * @type {string[]}
 */
const offenders = [];
for (const file of collect(SCRIPTS)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (WHITELIST.has(rel)) {
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (re.test(line)) {
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length) {
  process.stderr.write(
    `[git-dir-literal-scan] scripts/** 出现硬编码的 "${needle}" 路径拼接，除 scripts/git-dir.mjs 外不允许：\n`,
  );
  offenders.forEach((o) => process.stderr.write(`  ${o}\n`));
  process.exit(1);
}

const msg = "[git-dir-literal-scan] OK：检出子目录字面量只存在于 scripts/git-dir.mjs";
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({ ok: true, offenders: [] }));
} else {
  process.stdout.write(msg + "\n");
}
