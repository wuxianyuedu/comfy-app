#!/usr/bin/env node
// `executor-host.mjs` — ComfyUI 执行器独立宿主（P3 §5 第 2 期·Phase 2-B 骨架）
// ===========================================================================
//
// 本文件当前是**最小可用骨架**：只做「进程活着 + 日志落对地方 + 收到 SIGTERM
// 走 `killProcessTree()` 整树收」三条最小验证，**不领任务、不 spawn ComfyUI**。
// launcher 侧集成（Phase 2-C）、taskRepository 注入（Phase 2-A driver 抽取）、
// 主循环轮询 QUEUED（Phase 3）都是后续 PR 的事。
//
// 为什么要走「先起骨架再接流量」：plan §5 与 ADR §7 都点名 Phase 2 起手时
// 静态边已彻底扫清（P3 第 1 期 15 PR），但**运行时链路**（tsx 加载 TS + 相对
// 路径解析 + Windows 侧 SIGTERM→taskkill 派发时序）需要单独一次能跑起来才
// 好往下推。这一步就是那一次。
//
// 用法（手动 / 单测）：
//   node scripts/executor-host.mjs               默认：boot → 心跳 5s → 常驻
//   node scripts/executor-host.mjs --once        boot 完立即 exit 0（smoke 用）
//   node scripts/executor-host.mjs --interval=1000  心跳每 1s（默认 5s）
//
// 环境变量：
//   COMFYAPP_HOST_LOG     心跳落盘文件；默认 `log/services/executor-host.log`
//                          （相对项目根；测试会指到自己 tmpdir）
//   COMFYAPP_HOST_BOOT_ID 本次 boot 的短标识，进日志一行、便于跨进程 grep
//
// 退出码：
//   0   正常 boot + --once 或收到 SIGTERM/SIGINT 干净收尾
//   1   参数不合法 / 日志写盘失败但不影响主流程（只 warn）
//
// 与 launcher 的关系：Phase 2-C 之前，本文件**没有**在生产路径被拉起。它今天
// 的存在只是给单测与手工跑一份「可执行的骨架」——所以文件不进 `dev-launcher.mjs`
// 的 `spawnInGroup` 链、不进 `package.json` 用户面脚本。等 Phase 2-C 时一起接。

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const runOnce = argv.includes("--once");
const intervalArg = argv.find((a) => a.startsWith("--interval="));
const intervalMs = intervalArg
  ? Number.parseInt(intervalArg.split("=")[1] ?? "", 10)
  : 5_000;

/** 日志路径：默认落 `log/services/executor-host.log`（追加不轮转，与
 *  `comfyui-runtime.log` 同族）。测试用 COMFYAPP_HOST_LOG 指到 tmpdir。 */
const logPath =
  process.env.COMFYAPP_HOST_LOG ??
  path.join(ROOT, "log", "services", "executor-host.log");

/** 时间戳与 app-runtime.log 同形：本地时区、毫秒精度。避免在骨架阶段引入
 *  `src/lib/time-format` —— 那是 TS 侧、需要 tsx runtime 才能加载，Phase 2-C
 *  才会把 boot 顺序里的 configureXxx 链真接上；这里保持「纯 .mjs 无 TS」的
 *  最小依赖，方便单测直接 `spawn(node, [executor-host.mjs])`。 */
function localStamp(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, "0");
  const p3 = (n) => String(n).padStart(3, "0");
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`
  );
}

function writeLine(msg) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(
      logPath,
      `[${localStamp()}] [INFO] [executor-host] ${msg}\n`,
      "utf-8",
    );
  } catch (err) {
    // 日志写不进不能拖崩主循环；stderr 一行 + 继续跑。
    process.stderr.write(
      `[executor-host] 写日志失败（忽略）：${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// 项目根的锚点：与 launcher-core/log.mjs 的写入方式对齐（相对 ROOT 定位、
// 不假设 CWD 与脚本目录一致）。这样未来 launcher 从其它工作目录拉起也不飘。
process.chdir(ROOT);

const bootId =
  process.env.COMFYAPP_HOST_BOOT_ID ?? `${Date.now().toString(36)}`;

writeLine(
  `boot pid=${process.pid} bootId=${bootId} node=${process.version} platform=${process.platform}`,
);

if (runOnce) {
  writeLine("--once 模式：boot 完成、立即退出 0");
  process.exit(0);
}

// 心跳：每 intervalMs 写一行。Phase 3 会替换成「领 QUEUED → 驱动 → 写回」的
// 主循环，这里只是骨架阶段的存活证据。
const hb = setInterval(
  () => {
    writeLine(`heartbeat bootId=${bootId}`);
  },
  Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5_000,
);

function shutdown(sig) {
  clearInterval(hb);
  writeLine(`shutdown sig=${sig}`);
  // Phase 2-C 之后，这里会加：若 host 已经 spawn 了 ComfyUI / comfy-cli 子进程，
  // 走 `src/lib/process/kill-process-tree.ts` 的 .mjs 入口（`scripts/reap-process.mjs`）
  // 整树收。当前骨架没有子进程，只需清 setInterval + 落一行 shutdown。
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
