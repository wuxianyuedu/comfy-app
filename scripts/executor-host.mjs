#!/usr/bin/env node
// `executor-host.mjs` — ComfyUI 执行器独立宿主（P3 §5 第 2 期·Phase 3-B0）
// ===========================================================================
//
// 两种启动形态，由 `COMFY_EXECUTOR` env 选择（与 launcher 的 2-C 门控同一判据）：
//
//   inline/未设 → **骨架形态（2-B 原样）**：boot + 心跳 + SIGTERM 干净收尾，
//     不碰 DB、不 import 任何 TS。2-B 的三条契约测钉的就是这个形态。
//   host → **运行时形态（3-B0 新增）**：在骨架之上先跑 boot 注入链——
//     tsx 加载 TS → libsql file 客户端（与 `src/server/db.ts` 同一锚点规则）→
//     `createTaskRepoImpl(drizzle(client))` → `configureReaper({ owner:"host" })`
//     + `configureEnqueue` + `configureTraceLogPath` → Q2 首次扫表（**只扫
//     host 片**）。3-B0 **仍不领流量**：没有 claim 循环（3-B1 接），且此刻库中
//     不存在 `claimedBy='host'` 的行（tRPC 写值是 3-B1 的事），Q2 扫结构性为空。
//
// 为什么 host 形态必须给 reaper 注入 `owner:"host"`：reaper 在模块加载时有
// 一次性 sweep（`startReaper()` 的副作用），而孤儿判决依赖**进程内**内存足迹
// （`isTaskClaimedInProcess`）——host 看不见 inline 的在飞任务，不分片就会把
// inline 那些「QUEUED>30s 还没进 ComfyUI」的健康任务误判成孤儿杀掉。
// 分片判据与领取共用 impl 里同一条 `ownedBy()`，防归属漂移。
//
// 用法（手动 / 单测）：
//   node scripts/executor-host.mjs                    骨架：boot → 心跳 5s → 常驻
//   COMFY_EXECUTOR=host node scripts/executor-host.mjs  运行时：注入链 + Q2 + 心跳
//   加 --once        完成 boot（含注入链/Q2）后立即 exit 0（smoke 用）
//   加 --interval=1000  心跳每 1s（默认 5s）
//
// 环境变量：
//   COMFY_EXECUTOR        inline|host；host 才跑注入链（其它值按骨架，与 launcher 同判据）
//   COMFYAPP_HOST_LOG     心跳/boot 落盘文件；默认 `log/services/executor-host.log`
//   COMFYAPP_HOST_BOOT_ID 本次 boot 的短标识，进日志一行、便于跨进程 grep
//   DATABASE_URL          运行时形态的库地址（file: 前缀、相对 CWD=项目根，同 db.ts）
//   COMFYAPP_HOST_TRACE   执行链 trace 落点；默认 `log/comfyui/comfyui-trace-host.log`
//
// 退出码：
//   0   正常 boot（+注入链，`--once`）或收到 SIGTERM/SIGINT 干净收尾
//   1   参数不合法 / 日志写盘失败但不影响主流程（只 warn）/
//       **运行时形态 boot 注入链失败**（缺 tsx、库不可达等——起不来的 host
//       必须大声死，不许退化成心跳假活，规范硬规则 4）
//
// 与 launcher 的关系：`spawnExecutorHost()`（2-C）只在 `COMFY_EXECUTOR=host`
// 时拉起本脚本并透传 env；inline（默认）不 spawn。standalone 产物含 tsx 的
// 打包验证与「host 真的开始领流量」同属 3-B1/3-D 的灰度前置。

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseEnvFile } from "./env-preflight.mjs";

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

/** `COMFY_EXECUTOR` 判据与 `dev-launcher.mjs` 的 `spawnExecutorHost()` 门控一致：
 *  只有显式 `host` 才跑运行时注入链；其它值（含未设）保持 2-B 骨架行为，
 *  这样 2-B 的三条契约测（无此 env）不受影响。 */
const executorMode = (process.env.COMFY_EXECUTOR ?? "inline").toLowerCase();
const runtimeMode = executorMode === "host";

/** `DATABASE_URL` 解析优先级对齐 Next 侧（`src/env.mjs` 先读进程 env、再回退
 *  `.env`）。launcher 拉起本进程时只透传 `process.env`、不会把 `.env` 里的值
 *  导进来，所以宿主必须自己回读 `.env`——否则自定义库路径下，Next 连 A 库、
 *  host 连默认的 `./db.sqlite`（B 库），领取与执行对不上同一份任务表。 */
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envPath = path.join(ROOT, ".env");
    if (fs.existsSync(envPath)) {
      const parsed = parseEnvFile(fs.readFileSync(envPath, "utf-8"));
      const fromFile = parsed.get("DATABASE_URL");
      if (fromFile) return fromFile;
    }
  } catch {
    // 读 .env 失败不致命：退回默认库路径，与 db.ts 的空值兜底同形。
  }
  return "file:./db.sqlite";
}

/** 与 `src/server/db.ts::resolveDbPath` 同一锚点规则：`file:` 前缀剥离后按
 *  进程 CWD（已 chdir 到 ROOT）解析。不复用 db.ts 是因为它带 `import
 *  "server-only"`（宿主加载即 throw），这里只做等价的纯路径解析。 */
function resolveDbFile(url) {
  const value = url || "file:./db.sqlite";
  const raw = value.startsWith("file:") ? value.slice("file:".length) : value;
  return path.resolve(process.cwd(), raw || "./db.sqlite");
}

/** 运行时注入链（3-B0）：把 P3 §5 ADR §4 的 boot 顺序落到一个纯 Node 进程里，
 *  证明「执行链能在宿主加载 + 注入 + Q2 扫自己那片」。任何一步失败都**大声
 *  退出 1**——一个不注入却照常心跳的 host 比不起来的 host 更危险（规范硬规则
 *  4：失败路径要有用户可见出口，不许静默退化）。 */
async function bootRuntime() {
  const { register } = await import("tsx/esm/api");
  register();

  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const dbFile = resolveDbFile(resolveDatabaseUrl());
  const client = createClient({ url: `file:${dbFile}` });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");

  const { createTaskRepoImpl } =
    await import("../src/lib/core/repository-task-impl.ts");
  const hostRepo = createTaskRepoImpl(drizzle(client));

  const { configureReaper, reapStaleQueuedTasks, reapStaleRunningTasks } =
    await import("../src/lib/comfyui/reaper.ts");
  const { configureEnqueue } = await import("../src/lib/comfyui/enqueue.ts");
  const { configureTraceLogPath } = await import("../src/lib/comfyui/trace.ts");

  // owner:"host" —— Q2 扫表与 30s 定时 sweep 都只收 host 片，绝不误杀 inline
  // 的在飞任务（分片判据见文件头与 impl 的 ownedBy()）。
  configureReaper({ taskRepo: hostRepo, owner: "host" });
  configureEnqueue({ taskRepo: hostRepo });
  configureTraceLogPath(
    process.env.COMFYAPP_HOST_TRACE ??
      path.join(ROOT, "log", "comfyui", "comfyui-trace-host.log"),
  );
  writeLine("runtime inject-ok seams=reaper(owner=host)+enqueue+trace");

  const before = await hostRepo.listStaleQueued(
    new Date(Date.now() - 30_000),
    20,
    "host",
  );
  await reapStaleQueuedTasks();
  await reapStaleRunningTasks();
  writeLine(
    `runtime q2-scan hostShardQueued=${before.length} bootId=${bootId}`,
  );
}

writeLine(
  `boot pid=${process.pid} bootId=${bootId} node=${process.version} platform=${process.platform} mode=${runtimeMode ? "runtime" : "skeleton"}`,
);

if (runtimeMode) {
  try {
    await bootRuntime();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeLine(
      `runtime boot FAILED（注入链未通即退出，不退化成心跳假活）：${msg}`,
    );
    process.stderr.write(`[executor-host] 运行时注入链失败，退出 1：${msg}\n`);
    process.exit(1);
  }
}

if (runOnce) {
  writeLine(
    `--once 模式：boot${runtimeMode ? " + 运行时注入链" : ""} 完成、立即退出 0`,
  );
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
