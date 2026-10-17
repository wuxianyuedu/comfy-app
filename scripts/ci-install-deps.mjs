#!/usr/bin/env node
/**
 * ci-install-deps.mjs — 平台侧「装依赖」这一步的**唯一入口**：依赖面没动就不装。
 *
 * ## 为什么要它（ISSUE #1981 收尾）
 *
 * `.cnb.yml` 的 stage 级 `ifModify` 能回答「这次改动碰没碰某一步的扫描面」，
 * 但它只有「整步跳过」与「整步都跑」两档。`Install dependencies` 恰好是两半拼起来的：
 *
 *   · 前一半 `check-pnpm-available.mjs` 是**前提**步骤 —— 它回答「这个宿主起不起得来
 *     pnpm」，后面几十步都建立在这个答案上。跳过它等于让「没验过」看起来像「验过了」，
 *     所以它必须每次都跑（`ifModify` 在这里是错的工具）；
 *   · 后一半 `pnpm install --frozen-lockfile` 是**可以空转的**：锁文件与依赖面一个都
 *     没碰时，`node_modules` 里装的还是锁文件说的那一套，这一跳就是一次空操作 ——
 *     而它仍要花 pnpm 自己的启动与解析时间，以及 `postinstall` 里那几条 node 脚本。
 *
 * 于是收窄放在**步内**：整步照常执行，只有「装」那一跳按语义判。
 *
 * ## 判据（碰了什么才算「依赖面动了」）
 *
 * `DEP_FILES` 里任一项出现在本次事件的变更清单里 ⇒ 真装。清单刻意与
 * `pnpm install` 读的那几份对齐（`--frozen-lockfile` 只认锁文件，而 `pnpm-workspace.yaml`
 * 的 `allowBuilds` / `onlyBuiltDependencies` 与 `next.config.js` 的钉死项都会改变
 * 「装完之后 node_modules 长什么样」）；加一项的代价写在明处：**判宽了只是少省几秒，
 * 判窄了是拿一个陈旧的 `node_modules` 去跑门禁** —— 所以拿不准就加进来。
 *
 * ## 两条安全边界
 *
 * 1. **拿不到变更清单 ⇒ 装**（`push` 新建分支、非 git 环境、CNB 两个变量都空）：
 *    「不知道」不是「没变」，这条链上宁可多跑一次。
 * 2. **`node_modules` 不在或被清过 ⇒ 装**：跳过安装的前提是它真在（判据走
 *    `node_modules/.modules.yaml`，与启动器「装没装好」同一份口径）。
 *
 * ## 为什么是 `.mjs` 且有单测
 *
 * `.cnb.yml` 里的逻辑**一条判据都测不到它**（配置只在平台上跑，本地一个执行者都没有）——
 * 这条链上已经为此付过两次学费（§13.5.3.5 里那两段就地 PowerShell）。所以判定逻辑
 * 全部收在这个文件里，`tests/ci-install-deps.test.ts` 用注入的「变更清单 + 盘上有没有
 * node_modules」直接跑它，不碰真网络、不碰真安装。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 依赖面：碰了任一项就必须真装（见头注「判据」那一段）。 */
export const DEP_FILES = [
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "next.config.js",
];

/** 装好了的判据：`pnpm install` 自己写的元数据（与启动器同一份口径）。 */
const INSTALLED_PROBE = "node_modules/.modules.yaml";

/**
 * 从 CNB 的环境变量里读出「本次事件变了哪些文件」。
 *
 * 平台侧不注入「本次变了哪些文件」的环境变量，所以这里走 `git`：PR 事件 checkout 的是
 * **预合并提交**，`origin/<target>...HEAD` 正好是本次 PR 的变更集；`push` 事件退化成
 * 「与上一个提交比」，两样都拿不到就回 `null`（调用方据此真装）。
 *
 * 为什么不用 `git diff --name-only HEAD^..HEAD` 一把梭：`push` 事件推多个提交时那样只
 * 看得见最后一个 —— 而「依赖面」这件事恰恰可能在中途那个提交里被碰过。
 *
 * @param {(args: string[]) => {status: number, stdout: string}} run 注入给测试用
 * @returns {string[] | null} 变更清单（相对仓库根、正斜杠）；`null` = 拿不到（要真装）
 */
export function changedFiles(run) {
  const attempts = [
    /* PR：平台 checkout 的是预合并提交，与目标分支的差集就是本次 PR 的变更面。
     * `CNB_PULL_REQUEST_TARGET_BRANCH` 缺省时退回 `master`（本仓唯一的目标分支）。 */
    ["diff", "--name-only", `origin/${targetBranch()}...HEAD`],
    /* push：与上一个提交比（新建分支时这条会失败，落进下面那支）。 */
    ["diff", "--name-only", "HEAD^..HEAD"],
    /* 本地 / 还没提交的形态：工作区与暂存区。前两条在「平台侧 checkout 出来的那份」
     * 上必然成立，而这一条让同一条判据在本地也跑得起来（判据只有一处实现，
     * 别让人为了「本地试着跑一次」再抄一遍逻辑）。 */
    ["diff", "--name-only", "HEAD"],
  ];
  /* ⚠️ 判据是「拿到了非空清单」，不是「命令退 0」：PR 事件上 `origin/<target>...HEAD`
   * 在「源分支就基于目标分支」时**退 0 且回空**（三点 diff 的空集形态），照「退 0 就
   * 采信」会把它读成「什么都没变」—— 于是依赖面被碰过的那次 PR 跳过安装，拿一个陈旧
   * 的 `node_modules` 去跑门禁。空清单在这里与「拿不到」同一档，继续试下一条。 */
  for (const args of attempts) {
    const out = run(args);
    if (out.status !== 0) continue;
    const files = out.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter(Boolean);
    if (files.length > 0) return files;
  }
  return null;
}

/** PR 的目标分支（`CNB_PULL_REQUEST_TARGET_BRANCH` 由平台注入；缺省 `master`）。 */
function targetBranch() {
  const raw = process.env.CNB_PULL_REQUEST_TARGET_BRANCH;
  return raw === undefined || raw.trim() === "" ? "master" : raw.trim();
}

/**
 * 判定：这一次要不要真装。
 *
 * @param {{files: string[] | null, installed: boolean, depFiles?: readonly string[]}} state
 * @returns {{install: boolean, why: string}}
 */
export function decideInstall({ files, installed, depFiles = DEP_FILES }) {
  if (!installed) {
    return {
      install: true,
      why: "node_modules 不在或不完整（装好过的检出里它必然在）",
    };
  }
  if (files === null) {
    return {
      install: true,
      why: "拿不到本次变更清单（新建分支的 push / 非 git 环境）—— 「不知道」不是「没变」",
    };
  }
  const hits = files.filter((f) => depFiles.includes(f));
  if (hits.length > 0) {
    return { install: true, why: `依赖面被碰过：${hits.join(", ")}` };
  }
  return {
    install: false,
    why: `依赖面（${depFiles.join(" / ")}）一项都没碰，node_modules 里已是锁文件说的那一套`,
  };
}

/** 真跑一次 `pnpm install --frozen-lockfile`，退出码原样转出去。 */
function runInstall() {
  /* `shell: true` 只在 Windows 上必要（`pnpm` 是 `.cmd`，不经 shell 起不来）；
   * 而这条流水线**只跑在 Windows 自托管节点上**（`.common.runner.tags: [win]`）。 */
  const res = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.error) {
    process.stderr.write(`[ci-install-deps] ✗ 起不来：${res.error.message}\n`);
    return 1;
  }
  return res.status ?? 1;
}

/**
 * 入口。
 *
 * @param {{run?: (args: string[]) => {status: number, stdout: string}, install?: () => number}} [deps]
 *   全部可注入 —— 单测据此跑判定与出口，不碰真网络、不碰真安装。
 * @returns {number} 退出码
 */
export function main(deps = {}) {
  const run =
    deps.run ??
    ((args) => {
      const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
      /* `status` 在 spawn 自身失败时是 `null` —— 那一档在这里与「退非零」同义
       * （都是「这条 diff 拿不到」），所以就地归一，不把 `null` 漏给调用方。 */
      return { status: out.status ?? 1, stdout: out.stdout ?? "" };
    });
  const install = deps.install ?? runInstall;

  const files = changedFiles(run);
  const installed = fs.existsSync(path.join(ROOT, INSTALLED_PROBE));
  const verdict = decideInstall({ files, installed });

  if (!verdict.install) {
    process.stdout.write(`[ci-install-deps] ✓ 跳过安装：${verdict.why}\n`);
    return 0;
  }
  process.stdout.write(`[ci-install-deps] 安装：${verdict.why}\n`);
  return install();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
