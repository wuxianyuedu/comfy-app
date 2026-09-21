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
import { resolveAppPort } from "./app-port.mjs";
import { spawnSchemaSync } from "./db-schema-state.mjs";
import { exitIfEnvNotReady } from "./env-preflight.mjs";
import { pnpmInvocation } from "./launcher-core/shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
const port =
  Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : resolveAppPort(root);
process.stdout.write(
  `[dev.mjs] COMFYAPP_PORT=${port}${hostname ? ` host=${hostname}` : ""}\n`,
);

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
const schema = spawnSchemaSync(root);
if (!schema.started) {
  process.stdout.write(
    `[dev.mjs] ⚠ 无法后台核对数据库结构（${schema.reason ?? "原因未知"}）——` +
      "必要时手动跑：pnpm db:push\n",
  );
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
      `[dev.mjs]   实际命令：${invocation.command} ${invocation.args.join(" ")}\n`,
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
