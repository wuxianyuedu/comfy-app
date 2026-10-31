/**
 * 启动前的预检层（ISSUE #1811 拆 R5 超限文件）。
 *
 * 三件事：**工具链门禁**（node / pnpm / node_modules 三样在弹壳之前必须先过）、
 * **pnpm 版本一致性**、**旧版桌面壳提醒**（`shellStaleWarning` 同时被提交门禁
 * `scripts/shell-gate.mjs` 复用，见规范 §11.10.4）。外加把提醒补录进
 * app-runtime 通道的 `appendRuntimeWarning`。
 *
 * **依赖靠注入**：`ctx.log`（日志出口）、`ctx.stamp`（本次启动的 runtime 日志
 * 文件名后缀）、`ctx.setPnpmTip`（把修复提示交给启动页横幅 —— 门禁跑在弹壳之前，
 * 那一刻启动页还不存在，只能先记在模块里）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { orchestratePnpm, packageManagerVersion, preparePnpm, probePnpm } from "./corepack.mjs";
import { checkNodeModules } from "./worktree.mjs";
import { appRuntimeLogFileName, currentDirOf, localTimestamp } from "./log.mjs";

/** 工具链门禁：node 可用 + pnpm 可用 + node_modules 已装。
 *
 *
 *  双击链路里这一步尤其重要：**在弹壳之前**拦下致命损坏，用户才能看到一句
 *  「pnpm 坏了，怎么修」，而不是先弹出黑窗口再在启动页里慢慢报错。
 *
 *  探测与「坏了怎么修」都收在 `launcher-core/corepack.mjs`（Issue #576）：
 *    · 探测不再只看退出码 —— 命令压根没起来（EACCES/ENOEXEC）与命令报错退出
 *      是两种成因，此前都塌成一句「exit=?：未知错误」，把「PATH 上选错了可执行
 *      形态」误报成「corepack 缓存损坏」（后者要用户删缓存 / 重装 Node，方向全错）；
 *    · 修复提示里的版本号取自 package.json 的 `packageManager`，不再留
 *      `<项目版本>` 这种没人会去填的占位符；
 *    · spawn-error 一类（看起来就是缓存/形态坏了）会**自动 corepack prepare 重建
 *      并复核**，只有复核仍失败才落回提示 —— 把「自己就能好」的那部分留给自己。
 *
 *  @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void, setPnpmTip: (tip: string | null) => void }} ctx 日志出口与提示落点
 *  @param {string} [root] @returns {string | null} 失败原因（null = 通过） */
export function runToolchainGate(ctx, root = process.cwd()) {
  const pnpm = orchestratePnpm({ root });
  if (pnpm.repaired) {
    ctx.log(`pnpm 已自动修复：${pnpm.tip}`, "OK");
  }
  if (!pnpm.probe.ok) {
    ctx.setPnpmTip(pnpm.tip);
    return pnpm.tip ?? "pnpm 不可用";
  }
  const modules = checkNodeModules(root);
  if (!modules.healthy) {
    return (
      `node_modules 缺失或不完整（${modules.reasons.join("；")}）。\n` +
      "修复：pnpm install（首次上手可先跑 pnpm env:init 生成 .env；" +
      "Windows 双击入口 tools/start/run-local.ps1 会把这两步一起做完）"
    );
  }
  return null;
}

/** pnpm 版本一致性：不一致时尝试 corepack 对齐；失败只提示（不阻断启动）。
 *
 *  「本机版本」与「期望版本」都走 corepack.mjs 的单一判据：版本号只从
 *  package.json 的 `packageManager` 解析，命令探测只用 `probePnpm()` ——
 *  这里不再自己 whichCommand + spawnSync 一遍（那种写法会让「探测失败」在
 *  两个地方各有一套说法，正是 Issue #576 里「同一件事两个口径」的形态）。
 *
 *  @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void }} ctx 日志出口
 *  @param {string} [root] @returns {{ version: string, expected: string, tip: string | null } | null} */
export function reconcilePnpmVersion(ctx, root = process.cwd()) {
  const expected = packageManagerVersion(root);
  if (!expected) {
    return null;
  }
  const probe = probePnpm({ root });
  if (!probe.ok) {
    return null;
  } // 门禁已就「不可用」给过提示，这里不再叠一句
  const actual = probe.version ?? "";
  if (actual.replace(/^v/, "") === expected.replace(/^v/, "")) {
    ctx.log(`pnpm 版本匹配：${actual}（packageManager: pnpm@${expected}）`, "OK");
    return { version: actual, expected, tip: null };
  }
  ctx.log(`pnpm 版本不匹配：本机 ${actual}，package.json 要求 ${expected}`, "WARN");
  // 对齐动作就是「按 packageManager 重建」——与门禁里的自动修复同一个实现。
  const prepare = preparePnpm({ root, expected });
  const after = probePnpm({ root });
  const now = after.version ?? "";
  if (after.ok && now.replace(/^v/, "") === expected.replace(/^v/, "")) {
    ctx.log(`corepack 已自动切换 pnpm 至 ${now}`, "OK");
    return { version: now, expected, tip: null };
  }
  ctx.log(`corepack 对齐未生效（${prepare.description}，当前 ${now || "未知"}）`, "WARN");
  return {
    version: actual,
    expected,
    tip:
      `pnpm 版本不匹配（本机 ${actual}，项目要求 ${expected}）；` +
      `请执行 corepack enable && corepack prepare pnpm@${expected} --activate 后重启应用`,
  };
}

/** 旧版桌面壳提醒（比时间戳）。同一判据被提交门禁 `scripts/shell-gate.mjs` 复用：
 *  暂存改动命中壳输入时，它从「启动时 WARN」升成「阻断未重编的提交」，见规范 §11.10.4。 */
/** @param {string} shellExe @param {string} [root] @returns {string | null} */
export function shellStaleWarning(shellExe, root = process.cwd()) {
  let exeTime;
  try {
    exeTime = fs.statSync(shellExe).mtimeMs;
  } catch {
    return null;
  }
  const targets = [
    path.join(root, "src-tauri", "tauri.conf.json"),
    path.join(root, "src-tauri", "build.rs"),
    path.join(root, "src-tauri", "src"),
    path.join(root, "src-tauri", "splash-assets"),
  ];
  let newest = 0;
  for (const target of targets) {
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const file of walkFiles(target)) {
        try {
          newest = Math.max(newest, fs.statSync(file).mtimeMs);
        } catch {
          /* 忽略读不到的条目 */
        }
      }
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  if (newest <= exeTime) {
    return null;
  }
  return (
    `正在运行旧版桌面壳（编译于 ${localTimestamp(new Date(exeTime)).slice(5, 16)}，源码此后有改动），` +
    "界面可能不是最新逻辑；建议重编：cd src-tauri && cargo build --release --features custom-protocol"
  );
}

/** 递归列出目录下的文件（用于壳时效判据）。 */
/** @param {string} dir @returns {string[]} */
function walkFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** 把壳/pnpm 提醒补录进应用日志面板可见的 app-runtime 通道。
 *  （此刻 dev server 尚未启动，无法走写入端点，按面板可解析的行格式直接追加。）
 *
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void, stamp: string }} ctx 日志出口与本次启动戳
 * @param {string} message @param {string} [root] */
export function appendRuntimeWarning(ctx, message, root = process.cwd()) {
  try {
    const dir = currentDirOf("services", root);
    fs.mkdirSync(dir, { recursive: true });
    const ts = localTimestamp();
    /* 落**本次启动那一份**（与 dev server 随后写的是同一个文件名，见
     * `appRuntimeLogFileName` 与 `launchStamp`）：固定名会被读侧当成
     * 「更早的日志」并在轮转里当最旧的一份先删掉，而那正是这条通道的字面
     * 事故形态。 */
    fs.appendFileSync(
      path.join(dir, appRuntimeLogFileName(ctx.stamp)),
      `[${ts}] [WARN] [launcher] ${message}\n`,
      "utf8",
    );
  } catch {
    /* 提醒落不进面板不影响启动 */
  }
}
