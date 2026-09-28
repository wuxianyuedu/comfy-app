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
 *   · **宿主得有人拉起**，而且不能由 Next 进程 fork——那正是 Phase 4-B3 才卸掉的耦合
 *     （宿主与 server 同生死，崩了一起没了），也与「谁负责起执行宿主」的终态相反。
 *   · 因此这一层是壳的**直系子进程**：它起 server，必要时起宿主，两者都是它的孩子，
 *     退出时按整棵树回收。多出来的一层进程由既有的两条机制兜住——壳的 Job Object
 *     （`KILL_ON_JOB_CLOSE`）与壳退出时的 `scripts/reap-process.mjs` 补刀。
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
import {
  buildStandaloneRuntimeEnv,
  ensureStandaloneSchema,
} from "./launcher-core/standalone-runtime-env.mjs";

/** 应用根 = 本文件所在的 `scripts/` 的上一层：standalone 载荷的四个必需件
 *  （`server.js` / `package.json` / `.next/` / `node_modules/`）都在这一层。
 *  自定位而不是信传入的 cwd——Next 的 server 启动即 `process.chdir(__dirname)`，
 *  任何依赖 cwd 的锚点在它手里都会漂。 */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(APP_ROOT, "server.js");
const REAP_ENTRY = path.join(APP_ROOT, "scripts", "reap-process.mjs");

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
 *  打开这两份文件之后才 spawn server。 */
function openServerLogFiles() {
  const dir = path.join(APP_ROOT, "log", "nextjs");
  mkdirSync(dir, { recursive: true });
  pruneTimestampedLogs(dir, ["standalone-server-stdout-", "standalone-server-stderr-"], 5);
  const stamp = runStamp();
  return {
    stdoutFile: path.join(dir, `standalone-server-stdout-${stamp}.log`),
    stderrFile: path.join(dir, `standalone-server-stderr-${stamp}.log`),
  };
}

/** 回收一棵树：走命令行入口而不是在这里拼 `taskkill` / `process.kill`（硬规则 3）。
 *  默认等待结果，`via` 落日志——「打了命令、退出 0、进程还在」是这类兜底最坏的形态。 */
function reapTree(pid) {
  if (!pid) return;
  const run = spawnSync(process.execPath, [REAP_ENTRY, String(pid), "--force"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (run.status === 0) line(`reap pid=${pid} ${out}`);
  else line(`reap FAILED pid=${pid} exit=${run.status ?? "?"} ${out}`);
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
  const { stdoutFile, stderrFile } = openServerLogFiles();
  const server = spawnInGroup({
    command: process.execPath,
    args: [SERVER],
    // cwd = 应用根：Next 会自己 chdir 到这里，提前对齐让 `log/`、`data/`、
    // `public/generated/` 这些按 cwd 解析的运行期目录与 server 看到的是同一处。
    cwd: APP_ROOT,
    env: childEnv,
    stdoutFile,
    stderrFile,
  });
  line(`boot pid=${process.pid} server=${server.pid ?? "?"} port=${port} appRoot=${APP_ROOT}`);

  let closing = false;
  const close = (reason, exitCode) => {
    if (closing) return;
    closing = true;
    line(`closing (${reason})`);
    // 只在「还活着」时回收：child 已经退出时再补一刀，taskkill 报的是「没有找到进程」，
    // 于是每条正常退出路径都会在日志里留一行假的 reap FAILED（实测就是这样，判据
    // 与 dev-launcher 的 reapAll 同一形态：exitCode / signalCode 两个都判）。
    if (server.exitCode === null && server.signalCode === null) reapTree(server.pid);
    process.exit(exitCode);
  };

  server.on("error", (err) => {
    fail(`server failed to start: ${err?.message ?? err}`);
  });
  server.on("exit", (code, signal) => {
    // server 走了这个入口就没有存在的理由：退出码原样上抛，壳据此写它的失败出口。
    close(`server exited code=${code ?? "null"} signal=${signal ?? "null"}`, code ?? 1);
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGBREAK"]) {
    process.on(sig, () => close(`signal ${sig}`, 0));
  }
}

main();
