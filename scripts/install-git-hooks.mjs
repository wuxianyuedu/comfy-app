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

// 不在 git 检出里（如从 tarball 解包）时无事可做 —— 不是错误。
if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
  process.exit(0);
}

if (
  git(["config", "--local", "--get", "core.hooksPath"]).stdout === HOOKS_PATH
) {
  say(`core.hooksPath 已指向 ${HOOKS_PATH}（提交门槛已生效）`);
  process.exit(0);
}

if (git(["config", "--local", "core.hooksPath", HOOKS_PATH]).ok) {
  say(
    `已启用提交门槛：core.hooksPath=${HOOKS_PATH}（见 docs/standards/13-提交与-code-review.md §13.5）`,
  );
} else {
  say(
    `警告：设置 core.hooksPath 失败，提交门槛未生效` +
      `（可手动执行 git config core.hooksPath ${HOOKS_PATH}）`,
  );
}
// 钩子是**开发体验**兜底，不是依赖安装的必要条件：任何一步失败都不阻断安装。
process.exit(0);
