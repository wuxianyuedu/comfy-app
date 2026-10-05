#!/usr/bin/env node
// @ts-nocheck -- 纯 Node 运行入口：不在 Next 的模块图上，也不经 tsx
/**
 * standalone 桌包的运行入口（P3 §5 · ISSUE #1216）。
 *
 * 壳以前直接 `node server.js`，现在改成 `node scripts/standalone-runtime.mjs`。
 * 为什么中间要有这一层：
 *   · **运行期配置得有人装配**。分发产物里没有 `.env`（硬规则 17：`next build` 会
 *     无条件把开发机的 `.env` 与 `db.sqlite` 复制进 standalone，真正的防线是产物层
 *     剥离），而 `src/env.js` 启动时判的是「`.env` 文件在不在」。判据本体收在
 *     `launcher-core/standalone-runtime-env.mjs`，不在 Rust 侧再写一份（ADR §14 D5）。
 *   · **宿主得有人拉起**（3-E2b），而且不能由 Next 进程 fork——那正是 Phase 4-B3 才卸掉的耦合
 *     （宿主与 server 同生死，崩了一起没了），也与「谁负责起执行宿主」的终态相反。
 *   · 因此这一层是壳的**直系子进程**：它起 server，按 `COMFY_EXECUTOR` 起宿主，两者都是
 *     它的孩子，退出时按整棵树回收（先宿主后 server）。多出来的一层进程由既有的两条
 *     机制兜住——壳的 Job Object（`KILL_ON_JOB_CLOSE`）与壳退出时的
 *     `scripts/reap-process.mjs` 补刀。
 *
 * 加载哪一份图仍按**内容**判（与 `executor-host.mjs` 同一条取向）：这份入口在 → 壳用
 * 它；不在（旧载荷）→ 壳回到直接起 `server.js`。所以「忘了重编壳」与「载荷是旧的」
 * 两种情况都不会静默半接线。
 *
 * 失败路径一律大声退出（硬规则 4）：一个「什么都没起来却还在心跳」的入口比不起来的
 * 入口更危险，而桌包没有控制台——所有行都经壳的 shell 插件落到壳日志里。
 *
 * 用法（由壳调用，不是人敲的命令）：PORT=<端口> node scripts/standalone-runtime.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { spawnInGroup } from "./launcher-core/shell.mjs";
import { pruneTimestampedLogs } from "./launcher-core/worktree.mjs";
import { runStamp } from "./launcher-core/log.mjs";
import { resolveExecutorMode } from "./launcher-core/executor-mode.mjs";
import {
  buildStandaloneRuntimeEnv,
  ensureStandaloneSchema,
} from "./launcher-core/standalone-runtime-env.mjs";

/** 应用根 = 本文件所在的 `scripts/` 的上一层：standalone 载荷的四个必需件
 *  （`server.js` / `package.json` / `.next/` / `node_modules/`）都在这一层。
 *  自定位而不是信传入的 cwd——Next 的 server 启动即 `process.chdir(__dirname)`，
 *  任何依赖 cwd 的锚点在它手里都会漂。 */
const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SERVER = path.join(APP_ROOT, "server.js");
const REAP_ENTRY = path.join(APP_ROOT, "scripts", "reap-process.mjs");
/** 执行宿主的入口（3-E2b）。与 `server.js` 不同，它是**可选**的一路：开关没设
 *  就不该有它，所以判据是「设了 host 而这份不在」才报，而不是「不在就报」。 */
const HOST_ENTRY = path.join(APP_ROOT, "scripts", "executor-host.mjs");

function line(message) {
  process.stdout.write(`[standalone-runtime] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[ERROR] ${message}\n`);
  process.exit(1);
}

/** server 的 stdout/stderr 落**按次命名**的文件（与 launcher 起 dev server 同族同
 *  处理：固定名会被残留进程句柄锁死，见规范 §4 与硬规则 4），保留 5 份。
 *  文件名一律用 `runStamp()` 而不是 `localTimestamp()`：后者带冒号与空格（那是日志
 *  **行内容**的格式），在 Windows 上是非法文件名——实测打开就 ENOENT，而入口正是在
 *  打开这两份文件之后才 spawn server。
 *  `stamp` 由调用方给**一次**：server 日志、宿主日志与 `COMFYAPP_HOST_BOOT_ID` 必须
 *  是同一个值，否则「按 boot id 跨进程 grep」这条既有能力在桌包里就断了（两次
 *  `runStamp()` 跨秒就会给出不同的值，而这种错配只在日志里看得见）。 */
function openServerLogFiles(stamp) {
  const dir = path.join(APP_ROOT, "log", "current", "nextjs");
  mkdirSync(dir, { recursive: true });
  pruneTimestampedLogs(
    dir,
    ["standalone-server-stdout-", "standalone-server-stderr-"],
    5,
  );
  return {
    stdoutFile: path.join(dir, `standalone-server-stdout-${stamp}.log`),
    stderrFile: path.join(dir, `standalone-server-stderr-${stamp}.log`),
  };
}

/** 宿主的输出通道：与 launcher 的 `spawnExecutorHost` 同族（`log/services/` + 按次命名
 *  + 保留 5 份）。不接进本入口的输出流：宿主是 pino 中文日志，经壳的 shell 插件再落
 *  一次会与控制台编码打架（launcher 那份注释里记的就是这个），而且它的逐 tick 输出
 *  会淹没入口自己的 boot 行。 */
function openHostLogFiles(stamp) {
  const dir = path.join(APP_ROOT, "log", "current", "services");
  mkdirSync(dir, { recursive: true });
  pruneTimestampedLogs(
    dir,
    ["executor-host-stdout-", "executor-host-stderr-"],
    5,
  );
  return {
    stdoutFile: path.join(dir, `executor-host-stdout-${stamp}.log`),
    stderrFile: path.join(dir, `executor-host-stderr-${stamp}.log`),
  };
}

/** 回收一棵树：走命令行入口而不是在这里拼 `taskkill` / `process.kill`（硬规则 3）。
 *  默认等待结果，`via` 落日志——「打了命令、退出 0、进程还在」是这类兜底最坏的形态。 */
function reapTree(pid) {
  if (!pid) return;
  const run = spawnSync(
    process.execPath,
    [REAP_ENTRY, String(pid), "--force"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (run.status === 0) line(`reap pid=${pid} ${out}`);
  else line(`reap FAILED pid=${pid} exit=${run.status ?? "?"} ${out}`);
}

/** 按开关拉起执行宿主（3-E2b，ISSUE #1216 收口的那一半）。返回 child，或 null = 没起
 *  （inline / 未知值 / 设了 host 但入口不在）。
 *
 *  开关判据用 `resolveExecutorMode()` 那**唯一定义**（ADR §14 D5）：桌包里它的来源是
 *  壳进程继承下来的环境变量（载荷不含 `.env`，硬规则 17），不另造文件开关或库开关——
 *  多一个来源就是多一处会与人对不上的判决，而「Next 以为 host、host 跑成骨架」这类
 *  错配历史上已经吃过（executor-mode.mjs 模块头记着）。 */
function spawnExecutorHost(childEnv, stamp) {
  const { mode, unknown } = resolveExecutorMode({ procEnv: process.env });
  if (unknown !== null) {
    line(
      `executor mode=inline unknown=${JSON.stringify(unknown)}（只认 inline|host）`,
    );
    return null;
  }
  line(`executor mode=${mode}`);
  if (mode !== "host") return null;
  if (!existsSync(HOST_ENTRY)) {
    // 设了开关而入口不在：行会被写成 host 归属然后安静留在队列（#1204 之后的既定
    // 形态）。**不**退回 inline——那时已经写下的归属片没人领，现场只会更难查。
    line(
      `host SKIPPED: no ${HOST_ENTRY} in the payload; tasks will stay queued ` +
        "(re-assemble with node scripts/build-desktop.mjs)",
    );
    return null;
  }
  const { stdoutFile, stderrFile } = openHostLogFiles(stamp);
  const host = spawnInGroup({
    command: process.execPath,
    args: [HOST_ENTRY],
    cwd: APP_ROOT,
    // 与 server 共用同一份装配结果（绝对 `DATABASE_URL`、`SKIP_ENV_VALIDATION`、
    // 运行期密钥…）——两处各拼一遍等于给「宿主读的库不是 server 的库」留缝。
    // 只覆盖两项：归一化后的开关值（宿主自己只认 `COMFY_EXECUTOR`，不传就起骨架）
    // 与 boot id（让宿主日志与入口日志能按同一个时间戳互相 grep）。
    env: { ...childEnv, COMFY_EXECUTOR: mode, COMFYAPP_HOST_BOOT_ID: stamp },
    stdoutFile,
    stderrFile,
  });
  line(`host pid=${host.pid ?? "?"} out=${stdoutFile} err=${stderrFile}`);
  return host;
}

function main() {
  if (!existsSync(SERVER)) {
    fail(`standalone payload has no server.js next to this entry: ${SERVER}`);
  }
  const port = Number.parseInt(String(process.env.PORT ?? ""), 10);
  let childEnv;
  try {
    childEnv = buildStandaloneRuntimeEnv({ appRoot: APP_ROOT, port });
  } catch (err) {
    fail(`cannot assemble runtime env: ${err?.message ?? err}`);
  }
  // 首启建表：桌包既没有 pnpm 也没有 drizzle-kit（那是构建依赖），库里一张表都没有时
  // 应用随包的 DDL（§构建期由 build-desktop.mjs 现生成，只含结构）。不先做这一步，
  // 现场是「页面 200、接口全 500」+ hint 让人去跑 `pnpm db:push`——桌面用户做不到。
  // 宿主也必须排在它之后：它一起来就要读 `task` 表。
  try {
    const schema = ensureStandaloneSchema({ appRoot: APP_ROOT });
    line(
      schema.applied
        ? `schema bootstrap tables=${schema.tablesBefore}->${schema.tablesAfter}`
        : `schema ready tables=${schema.tablesAfter}`,
    );
  } catch (err) {
    fail(`schema bootstrap failed: ${err?.message ?? err}`);
  }
  const stamp = runStamp();
  const { stdoutFile, stderrFile } = openServerLogFiles(stamp);
  const server = spawnInGroup({
    command: process.execPath,
    args: [SERVER],
    // cwd = 应用根：Next 会自己 chdir 到这里，提前对齐让 `log/`、`data/`、
    // `generated/`（产物根）这些按 cwd 解析的运行期目录与 server 看到的是同一处。
    cwd: APP_ROOT,
    env: childEnv,
    stdoutFile,
    stderrFile,
  });
  line(
    `boot pid=${process.pid} server=${server.pid ?? "?"} port=${port} appRoot=${APP_ROOT}`,
  );
  let host = spawnExecutorHost(childEnv, stamp);
  if (host) {
    host.on("exit", (code, signal) => {
      // **不降级、不重启**（签字口径）：降级会让已经写成 host 归属的行变成没人领的
      // 孤儿，重启会把「起不来的宿主」掩盖成「慢」；server 继续在跑，用户仍看得见
      // 界面与排队数，这一行与那两份日志就是出口。
      line(
        `host exited code=${code ?? "null"} signal=${signal ?? "null"} ` +
          "（server 继续在跑；任务会留在队列，明细见上面 host pid= 那行给的 stderr）",
      );
      host = null;
    });
    host.on("error", (err) => {
      line(`host spawn error: ${err?.message ?? err}`);
      host = null;
    });
  }

  let closing = false;
  const close = (reason, exitCode) => {
    if (closing) return;
    closing = true;
    line(`closing (${reason})`);
    // 先收宿主再收 server：宿主是「还会往外发任务」的那一侧，先让它停，避免 server
    // 已经没了而宿主还在提交。两处都只在「还活着」时回收——child 已退出再补一刀，
    // taskkill 报的是「没有找到进程」，于是每条正常退出路径都会在日志里留一行假的
    // reap FAILED（判据与 dev-launcher 的 reapAll 同一形态：exitCode/signalCode 都判）。
    if (host && host.exitCode === null && host.signalCode === null)
      reapTree(host.pid);
    if (server.exitCode === null && server.signalCode === null)
      reapTree(server.pid);
    process.exit(exitCode);
  };

  server.on("error", (err) => {
    fail(`server failed to start: ${err?.message ?? err}`);
  });
  server.on("exit", (code, signal) => {
    // server 走了这个入口就没有存在的理由：退出码原样上抛，壳据此写它的失败出口。
    close(
      `server exited code=${code ?? "null"} signal=${signal ?? "null"}`,
      code ?? 1,
    );
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGBREAK"]) {
    process.on(sig, () => close(`signal ${sig}`, 0));
  }
}

main();
