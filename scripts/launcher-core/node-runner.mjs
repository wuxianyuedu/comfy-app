// `node <脚本>` 的启动形态与退出语义 —— 启动编排与桌面启动器**共用同一份判据**。
//
// 为什么单独放在这里：Windows 上进程只能由 CreateProcess 起，Node 的 `spawnSync`
// **不解析 shebang**（libuv 把文件路径原样交给 CreateProcess）：PATH 上那些
// corepack 写的无扩展名 shim（`pnpm` / `npx`，本质是 `#!/usr/bin/env node` 脚本）
// 一律 EACCES/ENOEXEC。更麻烦的是「起不来」在 API 上长得像「跑完就退出」：
// `spawnSync` 在 spawn 失败时 `status === null`，把 `status ?? 0` 读成退出码就得到
// **成功退出 0** —— 启动器会当一切正常，直到几十秒后用户发现窗口没出来
// （ISSUE #576 第五轮就是这么潜伏的：`dev.mjs` 写死 `pnpm.cmd`）。
//
// 因此三件事必须机器可查、且只有一份实现：
//   ① 起 **node** 用 `process.execPath`（当前解释器的绝对路径），不写 `"node"`；
//   ② 退出码：`status` 是数字才可信，`null` 一律当**失败**（不是 0）；
//   ③ 「起不来」（`error`）与「跑完非零退出」分开报，前者要看 `error.code`。

import { spawnSync } from "node:child_process";

/** 起 node 脚本用的可执行文件：当前解释器自身。
 *
 *  `"node"` 这个名字在 Windows 上要靠 PATH + 关联解析（Electron / 打包壳里
 *  `process.execPath` 根本不是 node），用 `process.execPath` 才是同一件事的唯一口径。
 *
 * @returns {string}
 */
export function nodeExecutable() {
  return process.execPath;
}

/**
 * 把 `spawnSync` 的结果翻译成「这次到底怎么了」。
 *
 * @param {{ status?: number | null, error?: NodeJS.ErrnoException | null, stdout?: string | Buffer | null, stderr?: string | Buffer | null }} result
 * @param {string} command 供报错文案显示的**真实命令**（拼好的整串）。
 * @returns {{ ok: boolean, exitCode: number | null, spawnError: string | null, detail: string }}
 */
export function interpretRunResult(result, command) {
  const spawnError = result.error
    ? String(result.error.code ?? result.error.message ?? "unknown")
    : null;
  if (spawnError) {
    return {
      ok: false,
      exitCode: null,
      spawnError,
      detail:
        `[ERROR] command did not start (${spawnError}): ${command} -- ` +
        `the executable form on PATH cannot be spawned by Node; run it via its own host instead`,
    };
  }
  if (typeof result.status !== "number") {
    // 既没有 error 也没有 status：终止信号（或平台把结果吞了）。**不是成功**。
    return {
      ok: false,
      exitCode: null,
      spawnError: null,
      detail: `[ERROR] command terminated without an exit code: ${command}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      exitCode: result.status,
      spawnError: null,
      detail: `[ERROR] command exited with code ${result.status}: ${command}`,
    };
  }
  return { ok: true, exitCode: 0, spawnError: null, detail: "" };
}

/** 去掉 BOM 与首尾空白（Windows 上 `>` 重定向写出的文件默认带 UTF-8 BOM）。 */
/**
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function stripBom(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

/**
 * 跑一条 node 脚本并**复核它写在 stdout 的结论**。
 *
 * 「退出码 0」在这类脚本上不是事实来源：`drizzle-kit push` 在无 TTY 时会
 * 「报错 + exit 0 + 留一个空库」（§9.2 第 4 条）。所以调用方传入一个复核函数，
 * 只有复核通过才算成功 —— 判据是**目标状态有没有达成**，不是进程怎么退的。
 *
 * @param {{ script: string, args?: string[], cwd: string, timeoutMs?: number, verify?: (stdout: string, stderr: string) => boolean }} options
 * @returns {{ ok: boolean, exitCode: number | null, spawnError: string | null, detail: string, stdout: string, stderr: string }}
 */
export function runNodeScript({
  script,
  args = [],
  cwd,
  timeoutMs = 600_000,
  verify,
}) {
  const command = [nodeExecutable(), script, ...args].join(" ");
  let result;
  try {
    result = spawnSync(nodeExecutable(), [script, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      exitCode: null,
      spawnError: message,
      detail: `[ERROR] failed to run node script: ${command} (${message})`,
      stdout: "",
      stderr: "",
    };
  }

  const verdict = interpretRunResult(result, command);
  const stdout = stripBom(result.stdout);
  const stderr = stripBom(result.stderr);
  if (!verdict.ok) return { ...verdict, stdout, stderr };
  if (verify && !verify(stdout, stderr)) {
    return {
      ok: false,
      exitCode: 0,
      spawnError: null,
      detail: `[ERROR] script reported success but the target state was not reached: ${command}`,
      stdout,
      stderr,
    };
  }
  return {
    ok: true,
    exitCode: 0,
    spawnError: null,
    detail: "",
    stdout,
    stderr,
  };
}

// ── 依赖安装的 `postinstall` 契约（AGENTS 硬规则 7）────────────────────────────
//
// `pnpm install` 会在包目录里跑 `package.json` 的 `postinstall`。它在**三种宿主**
// 下执行，而「用 `sh` 起一个 shell 脚本」这件事只有其中一种支持：
//
//   宿主                     | `sh` 解释器 | 说明
//   -------------------------|-------------|--------------------------------------
//   Windows（cmd.exe 语义）  | **没有**     | npm / pnpm 的脚本走 cmd.exe；写 `sh x.sh`
//                            |             | 就是「'sh' 不是内部或外部命令」，postinstall
//                            |             | 非零退出 → `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED`
//   Git for Windows 的 bash  | 有（随 Git） | 但那是**开发者的选择**，不是仓库能依赖的前提
//   Linux / macOS            | 有          | 正常
//
// 于是「仓库在 Windows 上跑不起 `pnpm install`」——而 `run-local.ps1`（面向非开发
// 人员的一键初始化）恰恰在 Windows 上跑，用户看到的是一屏 pnpm 报错，照提示
// 「检查网络后重试」永远修不好。CI 在 Linux 上跑，所以这条在流水线上**永远不红**。
//
// 契约：`postinstall` 只拉**跨平台同一个入口**（`node scripts/…`），脚本内部自己
// 判平台；禁止 `sh <脚本>` / 裸 `bash` / `&&`/`||` 之类的 shell 语法（cmd.exe 不认）。

/** 主入口脚本（跨平台唯一的 postinstall 实现）。 */
export const POSTINSTALL_SCRIPT = "scripts/install-git-hooks.mjs";

/** `postinstall` 里禁止出现的 shell 语法 / 宿主（判据见本文件顶部的三宿主表）。 */
export const POSTINSTALL_FORBIDDEN = [
  {
    pattern: /(^|[\s;&|])(?:sh|bash|zsh|dash|ksh)\s+\S/,
    reason: "用 sh/bash 起脚本：Windows 上没有 sh，cmd.exe 会直接报命令不存在",
  },
  {
    pattern: /\|\|/,
    reason: "`||` 兜底是 POSIX shell 语法，cmd.exe 不认（退出码语义也不同）",
  },
  {
    pattern: /(^|\s)&&(\s|$)/,
    reason: "`&&` 串联是 POSIX shell 语法，cmd.exe 不认",
  },
  {
    pattern: /(^|[\s;&|])source\s/,
    reason: "`source` 是 POSIX shell 内建，cmd.exe 不认",
  },
  {
    pattern: /\bnpx\b|\bnpm\s+run\b/,
    reason: "拒绝 npm / npx（AGENTS 硬规则 1，一律 pnpm）",
  },
];

/**
 * 校验一条 `postinstall` 命令是否满足「一份逻辑两端复用」的契约。
 *
 * @param {string} script `package.json` 的 `scripts.postinstall` 原文。
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkPostinstall(script) {
  const text = String(script ?? "").trim();
  if (!text)
    return { ok: false, reason: "postinstall 为空：钩子接线会被静默跳过" };
  // 先判具体语法（`sh x` / `||` / `&&` …）：它们给出的原因比「没以某字符串开头」
  // 具体得多，正是用户现场那句「'sh' 不是内部或外部命令」的机器形态。
  for (const { pattern, reason } of POSTINSTALL_FORBIDDEN) {
    if (pattern.test(text))
      return { ok: false, reason: `\`${text}\` — ${reason}` };
  }
  const entry = `node ${POSTINSTALL_SCRIPT}`;
  if (!text.startsWith(entry)) {
    return {
      ok: false,
      reason: `postinstall 必须逐字以 \`${entry}\` 开头（跨平台同一个入口），当前是「${text}」`,
    };
  }
  return { ok: true, reason: "" };
}
