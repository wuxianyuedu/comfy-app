#!/usr/bin/env node
/**
 * `ci-actionlint.mjs` —— GH workflows 的**真解析**校验（ISSUE #3063，档位选「只挂每日档」）。
 *
 * ## 它补的是哪一格
 *
 * `check:ci-yaml`（`scripts/check-ci-yaml-parse.mjs`）只判三件事：YAML 能解析、锚点 / 别名
 * 合法、CNB 的每格有非空 `name` + `script`。它能抓语法与结构，**抓不到 GitHub Actions 的
 * 语义错**：非法的 `on:` / `permissions:` 键、未知的 step 键、`uses` 形态不对、表达式语法
 * 坏 —— 这些在 YAML 层全是合法字符串，在平台层才会红，而那时的红与「这次改动」隔了一层。
 *
 * `.cnb.yml` **不做**这一层：CNB 没有公开 schema，手写一份的维护成本高于它能抓到的错
 * （#3063 的结论），它继续走 `check:ci-yaml`。本脚本只判 `.github/workflows/*.yml`。
 *
 * ## 取用纪律：**零网络**
 *
 * 二进制预置在节点的**常驻工具根**（`resolveToolRoot`，与 `#2525` 桌包那套同一条路）：
 * `COMFY_CI_TOOLS_ROOT` 优先，否则 `<pnpm store 所在卷>/ci-tools/<包名>`。本脚本
 * **绝不下载** —— 节点到 github.com 本就不稳（#3046），现下会把「今天取不到工具」的红
 * 伪装成「workflow 有错」的红。
 *
 * 版本与 sha256 钉死（{@link ACTIONLINT_PLAN}）：pin 变了就是「镜像该跟着升」，不是
 * 「取到什么算什么」。三种「拿不到」分开报：
 *   · 常驻根里没有这一份 ⇒ 退 2（没有结论），念出出口（本机 `--seed <exe>` / 配
 *     `COMFY_CI_TOOLS_ROOT`）；
 *   · 在场但 sha256 对不上 ⇒ 退 1（事实是坏的：镜像被换过或版本没同步）；
 *   · 二进制起不来 ⇒ 退 2。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-actionlint.mjs                    # 每日档那一格（判 .github/workflows）
 * node scripts/ci-actionlint.mjs --seed <exe 路径>   # 本机种进常驻根（先核 pin 的 sha256）
 * node scripts/ci-actionlint.mjs --dry-run          # 只打印会判哪几份、从哪儿取
 * ```
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { TOOLS_ROOT_ENV, resolveToolRoot } from "./ci-cache-slot.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 三态退码（与仓内其余档同口径：`0` 有结论且绿 / `1` 有事实是红 / `2` 没跑起来）。 */
export const CODE = { FAIL: 1, NO_FACT: 2, OK: 0 };

/**
 * 被钉住的那一份 actionlint。
 *
 * 两枚哈希都写在这里：`zipSha256` 是**上游发布页**公布的整包哈希（2026-11-04 从
 * `actionlint_1.7.7_checksums.txt` 逐字核对过），`exeSha256` 是解出来的那一个
 * `actionlint.exe`（种进常驻根的就是它，所以校验面必须是它而不是 zip）。
 */
export const ACTIONLINT_PLAN = {
  exeName: "actionlint.exe",
  exeSha256: "6d470a52039a433bccdf57bd65170885a5b23e511155d0de587c2c3ce0eb1c24",
  name: "actionlint",
  version: "1.7.7",
  zipSha256: "7f12f1801bca3d480d67aaf7774f4c2a6359a3ca8eebe382c95c10c9704aa731",
};

/**
 * 常驻根里那一份的落点（一个版本一个目录：升版本是「多一份」而不是「覆盖掉旧的」）。
 *
 * @param {string} root 常驻工具根 @returns {string} 目录绝对路径
 */
export function toolDir(root) {
  return path.join(root, `${ACTIONLINT_PLAN.name}-${ACTIONLINT_PLAN.version}`);
}

/**
 * 要判的那几份 workflow（**只认 `.github/workflows/` 下的 yml / yaml**）。
 *
 * @param {string} dir workflows 目录 @param {(d: string) => Array<string>} [readDir] 注入面
 * @returns {Array<string>} 仓库相对路径（排过序，日志与判据同一份顺序）
 */
export function workflowFiles(dir, readDir = (d) => fs.readdirSync(d)) {
  return readDir(dir)
    .filter((name) => /\.(?:yml|yaml)$/.test(name))
    .sort()
    .map((name) => path.posix.join(".github", "workflows", name));
}

/**
 * 文件的 sha256（十六进制小写）。
 *
 * @param {string} filePath @returns {string}
 */
export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * 校验常驻根里那一份：缺件 / 哈希不符 / 可用，三种结论各有各的退码。
 *
 * @param {{exePath: string, hashOf?: (p: string) => string}} args
 * @returns {{code: number, reason: string}}
 */
export function verifyBinary({ exePath, hashOf = sha256File }) {
  if (!fs.existsSync(exePath)) {
    return {
      code: CODE.NO_FACT,
      reason: `常驻根里没有 pin 的那一份（${ACTIONLINT_PLAN.name} ${ACTIONLINT_PLAN.version}）：${exePath}`,
    };
  }
  const actual = hashOf(exePath);
  if (actual !== ACTIONLINT_PLAN.exeSha256) {
    return {
      code: CODE.FAIL,
      reason: `sha256 对不上（期望 ${ACTIONLINT_PLAN.exeSha256}，实际 ${actual}）⇒ 镜像被换过或版本没同步`,
    };
  }
  return { code: CODE.OK, reason: "" };
}

/**
 * 命令行参数（只有三档：缺省判、`--seed 路径` 种、`--dry-run` 只看计划）。
 *
 * @param {Array<string>} argv @returns {{seed: string | null, dryRun: boolean, help: boolean}}
 */
export function parseArgs(argv) {
  /** @type {{seed: string | null, dryRun: boolean, help: boolean}} */
  const args = { dryRun: false, help: false, seed: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--seed") {
      args.seed = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

/**
 * 结论行 —— **放在最后一行**（平台日志页只看得到末尾时，这一行仍然读得到）。
 *
 * @param {{code: number, files: Array<string>, firstLine?: string, reason?: string}} args
 * @returns {string}
 */
export function renderVerdict({ code, files, firstLine = "", reason = "" }) {
  const head = `[actionlint] 结论：${code === CODE.OK ? "绿" : code === CODE.FAIL ? "红" : "没判"}`;
  if (code === CODE.OK) {
    return `${head} —— ${String(files.length)} 份 workflow 真解析通过（.cnb.yml 走 check:ci-yaml）`;
  }
  const why = reason || firstLine || "（没有拿到原因行）";
  return `${head} —— ${why}；判的面=${files.join(", ") || "（无）"}；第一处=${firstLine || "（无）"}`;
}

/** @param {string} line @returns {void} */
function log(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * 把一份**已被核过哈希**的 exe 种进常驻根（只拷、不下载）。
 *
 * @param {{source: string, toolRoot: string, copy?: (from: string, to: string) => void, hashOf?: (p: string) => string}} args
 * @returns {number} 三态退码
 */
export function seedBinary({
  source,
  toolRoot,
  copy = (from, to) => {
    fs.copyFileSync(from, to);
  },
  hashOf = sha256File,
}) {
  if (!fs.existsSync(source)) {
    log(`[actionlint] 种失败：源不在场 —— ${source}`);
    return CODE.NO_FACT;
  }
  const actual = hashOf(source);
  if (actual !== ACTIONLINT_PLAN.exeSha256) {
    log(
      `[actionlint] 种失败：sha256 对不上（期望 ${ACTIONLINT_PLAN.exeSha256}，实际 ${actual}）` +
        " —— 不是这个版本的那一件，不写进常驻根",
    );
    return CODE.FAIL;
  }
  const dir = toolDir(toolRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, ACTIONLINT_PLAN.exeName);
  copy(source, target);
  log(`[actionlint] 已种进常驻根：${target}（sha256 已复核）`);
  return CODE.OK;
}

/**
 * 主流程（`main` 只负责把参数递进来）。
 *
 * @param {object} [io]
 * @param {Array<string>} [io.argv]
 * @param {string} [io.cwd]
 * @param {Record<string, string | undefined>} [io.env]
 * @param {(p: string) => string} [io.hashOf]
 * @param {(args: Array<string>, opts: object) => {status: number | null, stdout?: string}} [io.runStore]
 * @param {(cmd: string, args: Array<string>, opts: object) => {status: number | null, stdout?: string, stderr?: string}} [io.spawn]
 * @param {(d: string) => Array<string>} [io.readDir]
 * @returns {number} 三态退码
 */
export function runCiActionlint(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const argv = io.argv ?? [];
  const args = parseArgs(argv);
  if (args.help) {
    log("用法：node scripts/ci-actionlint.mjs [--dry-run | --seed <actionlint.exe 路径>]");
    return CODE.OK;
  }
  const resolved = resolveToolRoot({
    cwd,
    env: io.env ?? process.env,
    run: io.runStore ?? ((a, o) => runPnpmSync(a, { ...o, stdio: "pipe" })),
  });
  log(`[actionlint] 常驻工具根：${resolved.root ?? "取不到"}（来源：${resolved.from}）`);
  if (!resolved.root) {
    log(
      `[actionlint] **没有结论**：问不出工具根 —— 配 ${TOOLS_ROOT_ENV} 是出口（本脚本不联网取用）`,
    );
    return CODE.NO_FACT;
  }
  if (args.seed) {
    return seedBinary({ hashOf: io.hashOf, source: args.seed, toolRoot: resolved.root });
  }
  const exePath = path.join(toolDir(resolved.root), ACTIONLINT_PLAN.exeName);
  const check = verifyBinary({ exePath, hashOf: io.hashOf });
  if (check.code !== CODE.OK) {
    log(`[actionlint] ${check.reason}`);
    log(
      `[actionlint] 出口：本机跑 \`node scripts/ci-actionlint.mjs --seed <actionlint.exe 路径>\`（pin 的 sha256 在脚本顶部）；` +
        `或把那一份预置到 ${toolDir(resolved.root)}`,
    );
    return check.code;
  }
  const files = workflowFiles(path.join(cwd, ".github", "workflows"), io.readDir);
  if (files.length === 0) {
    log("[actionlint] **没有结论**：`.github/workflows/` 下一份 yml 都没读到");
    return CODE.NO_FACT;
  }
  if (args.dryRun) {
    log(`[actionlint] 会判：${files.join(", ")}（exe=${exePath}）`);
    return CODE.OK;
  }
  const res = (io.spawn ?? spawnSync)(exePath, files, { cwd, encoding: "utf8" });
  const status = res?.status ?? null;
  const output = `${res?.stdout ?? ""}${res?.stderr ?? ""}`.trimEnd();
  if (output) {
    log(output);
  }
  if (status === null) {
    log(
      renderVerdict({ code: CODE.NO_FACT, files, reason: "actionlint 起不来（spawn 没拿到退码）" }),
    );
    return CODE.NO_FACT;
  }
  const firstLine =
    output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  log(renderVerdict({ code: status === 0 ? CODE.OK : CODE.FAIL, files, firstLine }));
  return status === 0 ? CODE.OK : CODE.FAIL;
}

/* `main` 只做一件事：把 CLI 递进 {@link runCiActionlint} 并把三态退码交出去。 */
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === path.resolve(import.meta.filename)) {
  process.exitCode = runCiActionlint({ argv: process.argv.slice(2) });
}
