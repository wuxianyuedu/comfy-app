#!/usr/bin/env node
// 统一的 dev server 启动入口：解析应用端口（.env 的 COMFYAPP_PORT，缺省按
// 检出路径推导，见 scripts/app-port.mjs）作为 Next.js dev 端口。
//
// 两条调用链都经本脚本，端口解析只此一处（launch-and-build.md §1.1）：
//   - `pnpm dev`（开发者 / Linux / CI，不依赖任何 .ps1）
//   - tauri.conf.json 的 beforeDevCommand（`pnpm tauri dev`）
// Windows 双击链路（dev-launcher.ps1）会显式传 `-p <port> -H 127.0.0.1`，
// 此时以命令行参数为准（见下方 parseArgs）——启动器已经算过端口，重算一遍
// 只会制造两个事实源。
//
// 「pnpm dev 也要经这里」的原因是端口契约：裸 `next dev` 会用 Next 的默认
// 3000，而 .env / 路径推导 / Playwright / 启动器全都按解析出的端口（缺省
// 3200..3999 区间）找服务 —— 两边不一致时表现为「服务起来了但连不上」。
// `pnpm start` 已因同类问题修过（scripts/start.mjs），这里补齐 dev 一侧。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_PORT_ENV_KEY, resolveAppPortWithSource } from "./app-port.mjs";
import { spawnSchemaSync, SKIP_SCHEMA_SYNC_ENV } from "./db-schema-state.mjs";
import { exitIfEnvNotReady } from "./env-preflight.mjs";
import {
  echoCommandLine,
  formatCommandLine,
} from "./launcher-core/command-echo.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 端口来源的可读标签（与 app-port.mjs 的 resolveAppPortWithSource 一一对应）。 */
const PORT_SOURCE_LABEL = {
  env: `.env 的 ${APP_PORT_ENV_KEY}`,
  derived: "按检出路径推导（3200~3999）",
  fallback: "兜底 3100（路径推导不可用）",
};

/** 解析透传参数：-p/--port 覆盖端口，-H/--hostname 指定监听地址。
 *  未显式给出时都用解析值/默认值，保证「开发者手工 pnpm dev」与
 *  「启动器 pnpm dev -p N」走同一条命令构造路径。 */
function parseArgs(argv) {
  let port = null;
  let hostname = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--port") port = argv[i + 1] ?? port;
    else if (a.startsWith("--port=")) port = a.slice("--port=".length);
    else if (a === "-H" || a === "--hostname")
      hostname = argv[i + 1] ?? hostname;
    else if (a.startsWith("--hostname="))
      hostname = a.slice("--hostname=".length);
  }
  return { port, hostname };
}

const { port: portArg, hostname } = parseArgs(process.argv.slice(2));
// 命令行显式端口优先（启动器已经算好）；否则走 .env → 路径推导 → 兜底。
const parsed = Number.parseInt(portArg ?? "", 10);
const explicit = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
const resolved = resolveAppPortWithSource(root);
const port = explicit ? parsed : resolved.port;
// 端口来源一并打印：与壳「两侧读同一处」的判据就是这个值（ISSUE #821）。
// 只给数字的日志在「dev server 在 3100、壳在等 3809」时归不了因 —— 一眼看不出
// 是 .env 写的还是路径推出来的，而这两种情况的修法完全不同。
const sourceLabel = explicit
  ? "命令行 -p/--port"
  : PORT_SOURCE_LABEL[resolved.source];
process.stdout.write(
  `[dev.mjs] COMFYAPP_PORT=${port}${hostname ? ` host=${hostname}` : ""}（来源：${sourceLabel}）\n`,
);

// 「两侧读同一处」的自检（ISSUE #821）：端口**允许**来自命令行（启动器算过再传），
// 但命令行若与进程环境给出的 COMFYAPP_PORT 不一致，那就是有人算了两遍而口径不同 ——
// 这正是壳 3809 / dev server 3100 那类「永远对不上」的来源。不阻断启动（命令行是
// 权威入口），但必须说出来，否则用户只能看到一个连不上的端口。
const envPort = Number.parseInt(process.env[APP_PORT_ENV_KEY] ?? "", 10);
if (
  explicit &&
  Number.isInteger(envPort) &&
  envPort >= 1 &&
  envPort <= 65535 &&
  envPort !== port
) {
  process.stderr.write(
    `[dev.mjs] ⚠ 环境变量 ${APP_PORT_ENV_KEY}=${envPort} 与本次实际监听端口 ${port} 不一致：\n` +
      "[dev.mjs]   命令行的 -p/--port 优先，本次以它为准；但请确认调用方算端口的口径\n" +
      `[dev.mjs]   与 scripts/app-port.mjs 一致（.env 的 ${APP_PORT_ENV_KEY} → 路径推导 → 兜底 3100）。\n`,
  );
}

// 环境配置预检：失败就**在起 Next 之前**退出并给出可行动作。
// 放在这里的理由见 env-preflight.mjs —— 否则 Next 会先打印「✓ Ready」，
// 用户看到的是「起来了但报错」，而事实是端口无人监听。
exitIfEnvNotReady(root);

/* schema 自检 + **后台**同步：拉了含 schema 变更的代码之后不必记得跑
 * `pnpm db:push`（判据、自动做到哪一步为止见 db-schema-state.mjs）。
 *
 * 这里**不等它**——drizzle 一轮约 17 秒、同步一次 15~30 秒，等它等于「先同步、
 * 再起 Next」，用户要盯着空窗等半分钟才看到页面。等待时间还给用户，期间由页面
 * 自己说「正在同步，稍候刷新」（`GET /api/schema` + 状态栏）。 */
/* 编排器（dev-launcher.mjs）已经起过一份 schema 同步并把这个变量传进来：
 * 再跑一次就是两份 15~30s 的 drizzle 并发写同一个 db.sqlite。独立 `pnpm dev`
 * （没有编排器）时该变量不存在，仍走自己的同步。 */
if (process.env[SKIP_SCHEMA_SYNC_ENV] === "1") {
  process.stdout.write(
    "[dev.mjs] 数据库结构同步由启动编排器负责，这里跳过（避免两份 drizzle 并发写同一个库）。\n",
  );
} else {
  const schema = spawnSchemaSync(root);
  if (!schema.started) {
    process.stdout.write(
      `[dev.mjs] ⚠ 无法后台核对数据库结构（${schema.reason ?? "原因未知"}）——` +
        "必要时手动跑：pnpm db:push\n",
    );
  }
}

const nextArgs = ["exec", "next", "dev", "--turbo", "-p", String(port)];
// 显式指定监听地址时透传：Windows 上不固定 127.0.0.1 会被解析到 ::1（IPv6），
// 导致按 127.0.0.1 做的健康检查失败（启动器传 -H 127.0.0.1 即为此）。
if (hostname) nextArgs.push("-H", hostname);

// pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）：Windows 上
// 写死 `pnpm.cmd` 会选中 Node 起不来的批处理，spawnSync 于是「命令没起来」，
// `status` 为 null —— 旧写法 `process.exit(result.status ?? 0)` 把它读成
// 成功退出 0，dev server 静默消失，用户只看到「已启动」之后就没了（ISSUE #576）。
const invocation = pnpmInvocation(nextArgs);
if (!invocation) {
  process.stderr.write(
    "[dev.mjs] ✗ PATH 上找不到可用的 pnpm，无法启动 Next.js dev server。\n" +
      "[dev.mjs]   先跑 `pnpm check:toolchain` 看选中的命令与探测结果；\n" +
      "[dev.mjs]   若 PATH 上并存多个 pnpm 形态，让可执行的那个排在前面。\n",
  );
  process.exit(1);
}
if (invocation.viaHost) {
  // 「探测过了、起服务又换一种方式」是同一类缺陷的两半：这里明确写出实际命令形态，
  // 排查时不必再猜「到底跑的是哪个 pnpm」。
  process.stdout.write(
    `[dev.mjs] pnpm 形态：${invocation.candidate} 经宿主 ${invocation.command}\n`,
  );
}

// 起服务之前先回显命令行：dev server 一起就接管终端输出，之后看不出跑的是哪条
// （`>>> ` 与门禁脚本同一口径，一次运行的日志里 grep 得到全部命令行）。
echoCommandLine(invocation.command, invocation.args);

// Next.js dev 读取 PORT 环境变量；显式透传给 next dev 子进程
const result = spawnSync(invocation.command, invocation.args, {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});
// 命令**没起来**（EACCES / EINVAL / ENOENT）时 status 为 null，必须与「跑完但
// 非零退出」分开报：前者 stderr 通常是空的，只给退出码等于没说原因。
if (result.error) {
  process.stderr.write(
    `[dev.mjs] ✗ 起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}\n` +
      `[dev.mjs]   实际命令：${formatCommandLine(invocation.command, invocation.args)}\n`,
  );
  process.exit(1);
}
if (result.status === null) {
  process.stderr.write(
    "[dev.mjs] ✗ pnpm 进程未正常结束（可能被信号终止），无退出码可报。\n",
  );
  process.exit(1);
}
process.exit(result.status);
