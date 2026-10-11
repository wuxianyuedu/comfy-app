#!/usr/bin/env node
/**
 * `executor-host-spawn.mjs` — 「按开关拉起执行器宿主」的**同一份实现**
 * （跨平台启动编排的共用件）。
 *
 * ## 它取代的那三份分叉
 *
 * `COMFY_EXECUTOR=host` 时行会被写成 `claimedBy='host'`，而**只有宿主**会去领它
 * （inline 那一侧的回收器不跨片误杀，见 ISSUE #1204）。于是「谁拉起宿主」这件事
 * 一旦在某个启动入口上漏掉，现场就是「任务永远停在队列、无失败出口」——
 * 本文件的调用方此前有三份各自实现：
 *
 *   · `dev-launcher.mjs`（编排 6.5 步）—— 有；
 *   · `standalone-runtime.mjs`（桌包）—— 有（形态不同：env 复用外壳装配结果）；
 *   · `dev.mjs` / `start.mjs`（裸启动入口）—— **都没有**。
 *
 * 后两个是真实事故：`dev.mjs` 那一格已写进 `launch-and-build.md` §5 排障表，
 * 而 `start.mjs` 那一格**此前没有任何执行者** —— 它的调用方含 Playwright 的
 * CI 档（`playwright.config.ts` 的 webServer 在 `CI=1` 时跑 `pnpm start`），
 * 于是本机 `.env` 里写着 host 的开发者在 `CI=1 pnpm test:e2e` 下会看到两条
 * `@critical` 主链路用例各超时 60s 全红，报错话术却是「下游替身没应答」。
 *
 * ## 为什么不是「把这段抄进 `start.mjs`」
 *
 * 三处各写一份（哪怕逐字相同）的下场在 §12.12 已判过：两边一起改是纪律，
 * 不是机制。这里把「开关判据 → 拉起形态」收成一次，调用点只传自己的
 * `runTimestamp` 与 env。
 *
 * 平台机制（POSIX 进程组 / Windows taskkill 走 `/T`）走 `spawnInGroup`
 * 那**唯一**一份（AGENTS 硬规则 3），本模块不自建第二套。
 */
import fs from "node:fs";
import path from "node:path";

import { EXECUTOR_ENV_KEY, resolveExecutorMode } from "./executor-mode.mjs";
import { currentDirOf } from "./log.mjs";

/** launcher 那一份日志分级（`launcher-core/log.mjs` 的同名 typedef）。
 *
 *  @typedef {"STEP" | "OK" | "WARN" | "ERROR" | "INFO"} LogLevel */
import { spawnInGroup } from "./shell.mjs";
import { pruneTimestampedLogs } from "./worktree.mjs";

/** 宿主入口：相对**项目根**（不是相对本文件——宿主自己按 ROOT 锚定 CWD）。 */
export const EXECUTOR_HOST_SCRIPT = "scripts/executor-host.mjs";

/** 宿主 stdout/stderr 的按次命名前缀（保留份数由 {@link pruneTimestampedLogs} 管）。 */
export const EXECUTOR_HOST_LOG_PREFIXES = [
  "executor-host-stdout-",
  "executor-host-stderr-",
];

/** 最近 N 份宿主日志留下（与 nextjs 那两路同值：够追溯最近几次启动即可）。 */
export const EXECUTOR_HOST_LOG_KEEP = 5;

/** 本次要起宿主的判决。抽成纯函数，好让「哪些值会起」不依赖真起一次进程。 */
/**
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {{ mode: "host" | "inline", unknown: string | null, shouldSpawn: boolean }}
 */
export function planExecutorHostSpawn({ env = process.env } = {}) {
  const { mode, unknown } = resolveExecutorMode({ procEnv: env });
  /* 认不出的值**不猜意图**：按 inline 起（与 Next 侧同判据），但调用方要留一行
   * 可见提示（规范硬规则 4）。`shouldSpawn` 因此只看归一化后的 mode。 */
  return { mode, unknown, shouldSpawn: mode === "host" };
}

/**
 * 按开关拉起 `scripts/executor-host.mjs`；不该起 / 起不来时返回 `null`（**不抛**）。
 *
 * 返回 `null` 的三种情形各自的含义写清，因为它们的现场完全不同：
 *   · inline（含未设 / 认不出的值）—— 正常，Next 自己就是执行宿主；
 *   · 设了 host 但入口文件不在 —— 行已经会写成 host 归属，**只能留在队列**；
 *     这一条必须让调用方说出口（`reason`），否则就是「静默什么都需要解释」；
 *   · `spawn` 本身抛（权限 / 路径）—— 同样只警告不阻断：起不来的是宿主，
 *     应用本体还能跑（用户仍看得见界面与排队数）。
 *
 * @param {{
 *   root: string,
 *   runTimestamp: string,
 *   env?: Record<string, string | undefined>,
 *   platform?: NodeJS.Platform,
 *   logLine?: (message: string, level?: LogLevel) => void,
 * }} options
 * @returns {{ child: import("node:child_process").ChildProcess, stdoutFile: string, stderrFile: string } | null}
 */
export function maybeSpawnExecutorHost({
  root,
  runTimestamp,
  env = process.env,
  platform = process.platform,
  logLine = () => {},
}) {
  const plan = planExecutorHostSpawn({ env });
  if (plan.unknown !== null) {
    logLine(
      `${EXECUTOR_ENV_KEY}="${plan.unknown}" 不识别，按默认 inline 处理（可选：inline|host）`,
      "WARN",
    );
  }
  if (!plan.shouldSpawn) return null;

  const hostScript = path.join(root, EXECUTOR_HOST_SCRIPT);
  if (!fs.existsSync(hostScript)) {
    /* 设了开关而入口不在：**不退回 inline**。退回才是更坏的一档——那时已经按
     * host 归属写下的行没有任何宿主会领，而「谁该来领」这件事就从现场消失了
     * （与 `standalone-runtime.mjs` 的同款判断一致）。 */
    logLine(
      `✗ ${EXECUTOR_ENV_KEY}=host 但找不到 ${EXECUTOR_HOST_SCRIPT}：` +
        "任务会按 host 归属写库、留在队列等不到人领（不退回 inline）。",
      "WARN",
    );
    return null;
  }

  /* 宿主的 stdout/stderr 落**按次命名**的文件（与 nextjs-stdout/stderr 同族同
   * 处理），不接进调用方控制台：pino 的中文 warn 直接进 Windows 控制台会被按
   * GBK 解码成乱码（文件通道恒 UTF-8），且宿主逐 tick 的输出会淹没启动进度。 */
  const servicesDir = currentDirOf("services", root);
  pruneTimestampedLogs(servicesDir, EXECUTOR_HOST_LOG_PREFIXES, EXECUTOR_HOST_LOG_KEEP);
  const stdoutFile = path.join(
    servicesDir,
    `executor-host-stdout-${runTimestamp}.log`,
  );
  const stderrFile = path.join(
    servicesDir,
    `executor-host-stderr-${runTimestamp}.log`,
  );

  let child;
  try {
    child = spawnInGroup({
      command: process.execPath,
      args: [hostScript],
      cwd: root,
      stdoutFile,
      stderrFile,
      env: {
        .../** @type {NodeJS.ProcessEnv} */ (env),
        /* 显式回写归一化后的值：`.env` 来源时它不在 `process.env` 里，而宿主自己
         * 只认这个 key 来决定跑骨架还是运行时链——不传会出现「调用方认为 host
         * 模式、宿主起着骨架」的静默错配（ADR §14 D5）。 */
        [EXECUTOR_ENV_KEY]: plan.mode,
        // boot id 传下去，让宿主日志与调用方日志能按同一时间戳串起来。
        COMFYAPP_HOST_BOOT_ID: runTimestamp,
      },
      platform,
    });
  } catch (err) {
    logLine(
      `✗ 拉起 executor-host 失败（${
        err instanceof Error ? err.message : String(err)
      }）：任务会留在队列，` +
        "改用 inline 重启即可恢复（去掉 " +
        EXECUTOR_ENV_KEY +
        " 或设成 inline）。",
      "WARN",
    );
    return null;
  }

  logLine(
    `executor-host 已启动（PID ${child.pid ?? "?"}，${EXECUTOR_ENV_KEY}=host；` +
      `host 领取 claimedBy='host' 的行）`,
    "OK",
  );
  logLine(`host 输出通道：${stdoutFile} / ${stderrFile}`, "INFO");
  return { child, stdoutFile, stderrFile };
}
