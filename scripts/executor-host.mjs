#!/usr/bin/env node
// `executor-host.mjs` — ComfyUI 执行器独立宿主（P3 §5 第 2 期·Phase 3-B0）
// ===========================================================================
//
// 两种启动形态，由 `COMFY_EXECUTOR` env 选择（与 launcher 的 2-C 门控同一判据）：
//
//   inline/未设 → **骨架形态（2-B 原样）**：boot + 心跳 + SIGTERM 干净收尾，
//     不碰 DB、不 import 任何 TS。2-B 的三条契约测钉的就是这个形态。
//   host → **运行时形态（3-B0 地基 / 3-B1 接流量）**：boot 跑注入链——
//     tsx 加载 TS → libsql file 客户端（与 `src/server/db.ts` 同一锚点规则）→
//     `createTaskRepoImpl(drizzle(client))` → **六条 seam 全注入**（deps 复用
//     Next 侧同一份实现，理由见 `bootRuntime` 文件头注释）→ Q2 首扫（只扫
//     host 片）→ 主循环每 `CLAIM_TICK_MS` 领一行（`claimNextQueued("host",1)`
//     → 由 `execPayload` 重建 Job → `enqueue()` 走与 inline 同一条执行链）
//     + 取消收尾（本地 kill 在飞 comfy-cli）。
//
// 为什么领取要配 reaper 归属分片：孤儿判决依赖**进程内**内存足迹
// （`isTaskClaimedInProcess`），host 看不见 inline 的在飞任务，不分片就会把
// inline 那些「QUEUED>30s 还没进 ComfyUI」的健康任务误判成孤儿杀掉。
// 分片判据与领取共用 impl 里同一条 `ownedBy()`。
//
// 用法（手动 / 单测）：
//   node scripts/executor-host.mjs                    骨架：boot → 心跳 5s → 常驻
//   COMFY_EXECUTOR=host node scripts/executor-host.mjs  运行时：注入链 + Q2 + 领取循环
//   加 --once         完成 boot（含注入链/Q2）后立即 exit 0（smoke 用）
//   加 --claim-once   额外跑**恰好一个**领取 tick 后 exit 0（契约测钩子）
//   加 --interval=1000  心跳每 1s（默认 5s）
//
// 环境变量：
//   COMFY_EXECUTOR        inline|host；host 才跑注入链+领取（其它值按骨架，与 launcher 同判据）
//   COMFYAPP_HOST_LOG     心跳/boot 落盘文件；默认 `log/services/executor-host.log`
//   COMFYAPP_HOST_BOOT_ID 本次 boot 的短标识，进日志一行、便于跨进程 grep
//   DATABASE_URL          运行时形态的库地址（file: 前缀、相对 CWD=项目根，同 db.ts；
//                          未设时回读 .env——纯 Node 不注入 .env，见 resolveDatabaseUrl）
//   COMFYAPP_HOST_TRACE   执行链 trace 落点；默认 `log/comfyui/comfyui-trace-host.log`
//   COMFYAPP_HOST_CLAIM_TICK_MS 领取节拍；默认 2000
//
// 退出码：
//   0   正常 boot（+注入链/Q2/领取 tick，`--once` / `--claim-once`）或收到
//       SIGTERM/SIGINT 干净收尾
//   1   参数不合法 / 日志写盘失败但不影响主流程（只 warn）/
//       **运行时形态 boot 注入链失败**（缺 tsx、库不可达等——起不来的 host
//       必须大声死，不许退化成心跳假活，规范硬规则 4）
//
// 与 launcher 的关系：`spawnExecutorHost()`（2-C）只在 `COMFY_EXECUTOR=host`
// 时拉起本脚本，并把**归一化后**的 env 值显式传给子进程（`.env` 来源时子进程
// 本来看不到）；standalone 产物含 tsx 的打包验证属 3-D 灰度前置。

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseEnvFile } from "./env-preflight.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const runOnce = argv.includes("--once");
const claimOnce = argv.includes("--claim-once");
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

// 运行时句柄：bootRuntime 成功后填充，claim tick 与测试钩子共用。
let hostRuntime = null;

/** 领取节拍（ms）。与 inline 的「点一次跑一个」语义对齐：每 tick `take=1`，
 *  串行的深队列由 enqueue 自己的 MAX_CONCURRENCY 管，这里不一次领一串。 */
const CLAIM_TICK_MS =
  Number.parseInt(process.env.COMFYAPP_HOST_CLAIM_TICK_MS ?? "", 10) || 2_000;

/** 领一行并投递执行：`claimNextQueued`（单语句原子，见 impl）→ `findExecJob`
 *  从行重建 Job（载荷是**提交时刻**的 execPayload，不回查模板）→ `enqueue()`
 *  走与 inline 同一条执行链（六 seam 已在 boot 注入 host 版实现）。 */
async function claimTickOnce() {
  if (!hostRuntime) return;
  const { hostRepo, enqueueJob } = hostRuntime;
  const claimed = await hostRepo.claimNextQueued("host", 1);
  for (const taskId of claimed) {
    const row = await hostRepo.findExecJob(taskId);
    if (!row?.execPayload) {
      /* 行没有执行载荷 = 3-B1 之前的历史 host 行（理论不存在：那时没人写
       * claimedBy='host'）或建行异常。判失败留可见原因，不许变 RUNNING 僵尸
       * （host 片 reaper 是这条的兜底，主动收口是更快更准的那条）。 */
      await hostRepo.finalizeFailure(
        taskId,
        "任务缺少执行载荷（execPayload），host 无法重建执行请求",
      );
      writeLine(`claim-dropped taskId=${taskId} reason=missing-execPayload`);
      continue;
    }
    enqueueJob({
      taskId,
      workflowName: row.workflowName,
      rawJson: row.execPayload,
      overrides: row.params?.workflowInputs ?? undefined,
    });
    writeLine(`claim-dispatched taskId=${taskId} bootId=${bootId}`);
  }
  await reconcileCancelled();
}

/** 取消收尾最小版（ADR §13-3B1 决定 3）：`interrupt()` 是 POST 共享 ComfyUI、
 *  Next 侧跨进程仍有效，但 comfy-cli 子进程活在**本进程**的 `cliProcs` 里，
 *  Next 摸不到——tick 检查在飞行的 DB 状态，见 CANCELLED 就地 kill。
 *  kill 形态逐字对齐 `enqueue.cancelTask` 的同款三行（同一判据源，不另发明
 *  一套），finalize 守卫挡住被杀 cli 的迟到回写。 */
async function reconcileCancelled() {
  const { hostRepo, cliProcs } = hostRuntime;
  for (const taskId of [...cliProcs.keys()]) {
    try {
      const st = await hostRepo.findStatusAndPromptById(taskId);
      if (st?.status !== "CANCELLED") continue;
      const proc = cliProcs.get(taskId);
      if (!proc) continue;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore：与 cancelTask 同形——进程可能已自己退了 */
      }
      cliProcs.delete(taskId);
      writeLine(`cancel-reaped taskId=${taskId}`);
    } catch {
      /* DB 抖动不杀 tick：下一轮再看 */
    }
  }
}
/** 运行时注入链（3-B0 建地基 / 3-B1 接上执行链）：把 P3 §5 ADR §4 的 boot 顺序
 *  落到一个纯 Node 进程里。任何一步失败都**大声退出 1**——一个不注入却照常
 *  心跳的 host 比不起来的 host 更危险（规范硬规则 4：失败路径要有用户可见
 *  出口，不许静默退化）。
 *
 *  六条 seam 全部注入同一份 `hostRepo`（3-A/3-B1 的 impl 工厂）与**同一份
 *  Next 侧实现**（client.ts 的 resolveComfyBase/getView、core/logger）——它们
 *  都是 §18.4 第三类模块，宿主可直接加载；设置经 `app-settings.server.ts` 的
 *  文件缓存读到与 Next 相同的落盘值。实测「六 seam 全加载 + 注入」零
 *  unhandled rejection（见 changelog 碎片的 spike 记录）。 */
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
  // owner:"host" 与下方 configureReaper 的 owner 同源：impl 的收口写入现在带
  // 归属条件（ADR §14 D4），两处不一致会让本进程的收口全部静默 skip。
  const hostRepo = createTaskRepoImpl(drizzle(client), { owner: "host" });

  const { configureReaper, reapStaleQueuedTasks, reapStaleRunningTasks } =
    await import("../src/lib/comfyui/reaper.ts");
  const { configureEnqueue, enqueue } =
    await import("../src/lib/comfyui/enqueue.ts");
  const { configureTraceLogPath } = await import("../src/lib/comfyui/trace.ts");
  const { configureRunner } =
    await import("../src/lib/comfyui/runner-state.ts");
  const { configureExecutorCli, cliProcs } =
    await import("../src/lib/comfyui/executor-cli.ts");
  const { configureExecutorFinalize } =
    await import("../src/lib/comfyui/executor-finalize.ts");
  const { configureExecutorWs } =
    await import("../src/lib/comfyui/executor-ws.ts");
  const { resolveComfyBase, getView } =
    await import("../src/lib/comfyui/client.ts");
  const { logger } = await import("../src/lib/core/logger.ts");

  // owner:"host" —— Q2 扫表与 30s 定时 sweep 都只收 host 片，绝不误杀 inline
  // 的在飞任务（分片判据见文件头与 impl 的 ownedBy()）。
  configureReaper({ taskRepo: hostRepo, owner: "host" });
  configureEnqueue({ taskRepo: hostRepo });
  configureTraceLogPath(
    process.env.COMFYAPP_HOST_TRACE ??
      path.join(ROOT, "log", "comfyui", "comfyui-trace-host.log"),
  );
  // 执行链四条 seam（3-B1）：deps 全部复用 Next 侧同一份实现（文件头理由）。
  configureRunner({ taskRepo: hostRepo, log: logger });
  configureExecutorCli({ logger, taskRepo: hostRepo, resolveComfyBase });
  configureExecutorFinalize({
    taskRepo: hostRepo,
    getView,
    runtimeLog: logger,
  });
  configureExecutorWs({ taskRepo: hostRepo });
  hostRuntime = { hostRepo, enqueueJob: enqueue, cliProcs };
  writeLine(
    "runtime inject-ok seams=runner+cli+finalize+ws+enqueue+reaper(owner=host)+trace",
  );

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

/* 测试/排障钩子：跑**恰好一个**领取 tick 就退出。exit 掐掉 enqueue 刚拉起的
 * 异步链（connect 的探测/自动拉起都还在 microtask 里），不会在测试机上真把
 * ComfyUI 带起来——契约测断的是「领取发生 + 行翻 RUNNING」，不是全链执行。 */
if (claimOnce) {
  if (!hostRuntime) {
    writeLine(
      "--claim-once 需要 COMFY_EXECUTOR=host（骨架形态没有可领取的运行时）",
    );
    process.exit(1);
  }
  try {
    await claimTickOnce();
  } catch (err) {
    writeLine(
      `claim-tick FAILED：${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

if (runOnce) {
  writeLine(
    `--once 模式：boot${runtimeMode ? " + 运行时注入链" : ""} 完成、立即退出 0`,
  );
  process.exit(0);
}

// 心跳：每 intervalMs 写一行（骨架与运行时形态共用，2-B 契约的存活证据）。
const hb = setInterval(
  () => {
    writeLine(`heartbeat bootId=${bootId}`);
  },
  Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5_000,
);

/* 领取主循环（3-B1）：host 形态每 CLAIM_TICK_MS 领一行（无行可领时只是一个
 * 空 SELECT，不打日志防刷屏）；骨架形态不起这条循环。 */
let claimHandle = null;
if (runtimeMode) {
  claimHandle = setInterval(() => {
    claimTickOnce().catch((err) => {
      writeLine(
        `claim-tick 异常（下轮重试）：${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }, CLAIM_TICK_MS);
}

function shutdown(sig) {
  clearInterval(hb);
  if (claimHandle !== null) clearInterval(claimHandle);
  writeLine(`shutdown sig=${sig}`);
  /* 在飞 comfy-cli 子进程**不**在这里逐个 kill：launcher 回收走的是整树
   * （POSIX 进程组 / Windows taskkill /T，见 2-C），行留在 RUNNING 由下次
   * boot 的 Q2（host 片）对账收口——这是 ADR §8 定下的恢复语义。 */
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
