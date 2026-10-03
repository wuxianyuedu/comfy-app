#!/usr/bin/env node
// 把仓库自带的提交门槛接上：`core.hooksPath` 指向版本控制里的 `.githooks/`。
//
// **为什么是 .mjs 而不是 .sh**：git 不会自动采用仓库内的钩子，新克隆的检出默认
// 没有任何提交门槛（`.git/hooks/` 只有 `.sample`），所以它挂在 `package.json` 的
// `postinstall` 上。而 `postinstall` 在 Windows 上由 cmd.exe 语义执行 ——
// `sh scripts/install-git-hooks.sh` 会变成「'sh' 不是内部或外部命令」，
// postinstall 非零退出 → pnpm 报 `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED`，
// **整个 `pnpm install` 失败**：一键初始化入口（`tools/start/run-local.ps1`）
// 当场卡死，而 CI 在 Linux 上永远看不到这条（那里有 sh）。
//
// 同一个入口两端复用（规范 §9.5）：Node 是本仓库所有宿主的共同前提（启动编排、
// db-push、门禁链全在 Node 上），用它接钩子不需要任何平台分支。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_PATH = ".githooks";

/** 在仓库内跑一条 git 命令，返回 { ok, stdout }；git 缺失/非检出时 ok=false。 */
function git(args) {
  try {
    const r = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: r.status === 0, stdout: String(r.stdout ?? "").trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

function say(message) {
  process.stdout.write(`[hooks] ${message}\n`);
}

// 三态：不在检出里（tarball 解包）/ 已指向 .githooks / 这次接上。
// **不在这里 exit**：下面还有缓存指纹那一步要走，提前退出会让它在这三种最常见的
// 形态上全部静默跳过（那正是「靠人记得删 = 没有执行者」的翻版）。
if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
  say("不在 git 检出里，跳过提交门槛接线");
} else if (
  git(["config", "--local", "--get", "core.hooksPath"]).stdout === HOOKS_PATH
) {
  say(`core.hooksPath 已指向 ${HOOKS_PATH}（提交门槛已生效）`);
} else if (git(["config", "--local", "core.hooksPath", HOOKS_PATH]).ok) {
  say(
    `已启用提交门槛：core.hooksPath=${HOOKS_PATH}（见 docs/standards/13-提交与-code-review.md §13.5）`,
  );
} else {
  say(
    `警告：设置 core.hooksPath 失败，提交门槛未生效` +
      `（可手动执行 git config core.hooksPath ${HOOKS_PATH}）`,
  );
}

// ── 顺带失效 eslint 增量缓存（ISSUE #1399）───────────────────────────────────
//
// 为什么并在这里而不是往 `postinstall` 再挂一条命令：`postinstall` 的形状受
// `launcher-core/node-runner.mjs::checkPostinstall()` 约束（必须逐字以
// `node scripts/install-git-hooks.mjs` 开头，禁止 `&&` / `||` / `sh`）—— 那条契约
// 拦的正是 #636 的事故形态（拼接命令在 Windows 的 cmd.exe 语义下直接崩）。
// 本入口的定义就是「任何一步失败都只提示、`exit 0`、不阻断安装」，把这一步并进来
// 既满足同一条契约，也不用新增第二个 postinstall 执行者。
//
// 为什么需要它：eslint 的 `--cache` 缓存键**不含依赖树**，而 `no-unsafe-*` 是
// 类型化规则 —— 依赖一变，旧判决会被整片重放（假红拦死提交 / 假绿洗掉违规）。
// 详见 `scripts/eslint-cache-fingerprint.mjs` 的文件头与 ISSUE #1399。
//
// 失败语义与上面一致：检索引擎算不出指纹、缓存删不掉，都只提示，绝不让
// `pnpm install` 挂掉。
try {
  const { runFingerprint } = await import("./eslint-cache-fingerprint.mjs");
  runFingerprint({ root, log: say });
} catch (err) {
  say(`警告：eslint 缓存指纹失效这一步被跳过（${String(err)}）`);
}

// 上面两步都是**开发体验**兜底，不是依赖安装的必要条件：任何一步失败都不阻断安装。
process.exit(0);
