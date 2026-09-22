#!/usr/bin/env node
// 启动编排的共用件：进度快照、就绪等待、收尾证据判定（跨平台）。
//
// 「同一契约两套实现」是历史漂移的温床（Windows 侧的 .ps1 与 POSIX 侧的 .mjs
// 各写一份编排）。因此凡是**语义与平台无关**的部分都收在本模块：两侧都 import
// 它，改一处即两侧生效；平台机制差异只留在 procs / shell 两个模块里。

import fs from "node:fs";
import path from "node:path";

/** 进度快照的写入参数（字段口径与 .ps1 / splash.html 同一契约）。 */
/**
 * @typedef {object} LaunchStatusPayload
 * @property {string} phase
 * @property {number} progress
 * @property {string} message
 * @property {boolean} [ready]
 * @property {boolean} [error]
 * @property {number | null | undefined} [appPort]
 * @property {string | null} [staleShell]
 * @property {string | null} [pnpmMismatch]
 * @property {number | null} [startedAt]
 */

/**
 * 写 `run/launch-status.json`（启动页读它显示进度）。
 *
 * JSON **无 BOM**（启动页 JSON.parse 遇 BOM 会失败），非 ASCII 字符由 JSON
 * 转义自动处理。写失败一律静默：进度快照是体验，不是启动的必要条件。
 * @param {string} root
 * @param {LaunchStatusPayload} payload
 */
export function writeLaunchStatus(
  root,
  {
    phase,
    progress,
    message,
    ready = false,
    error = false,
    appPort = null,
    staleShell = null,
    pnpmMismatch = null,
    startedAt = null,
  },
) {
  const elapsed = startedAt
    ? Math.round((Date.now() - startedAt) / 100) / 10
    : 0;
  const body = {
    phase,
    progress: Math.round(progress * 1000) / 1000,
    message,
    elapsed,
    ready,
    error,
    app_url: `http://127.0.0.1:${appPort ?? 3100}/workspace`,
    stale_shell: staleShell,
    pnpm_mismatch: pnpmMismatch,
    updated_at: new Date().toISOString(),
  };
  try {
    const dir = path.join(root, "run");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "launch-status.json"),
      JSON.stringify(body),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * `/api/health` 的 503 里，只有这几种 `db` 值才算「表还没建」。
 *
 * 端点把两件事都编码成 503（见 `src/app/api/health/route.ts`）：schema 未就绪
 * 时回 `db: "empty" | "unknown"`，真连不上库时回 `db: "down"`。只有前两种属于
 * 「等一等 / 建一次表就能好」；把后者混进同一档会让启动器把「数据库起不来」
 * 说成「表还没建」，那是两种完全不同的处置。
 */
const SCHEMA_NOT_READY_DB = new Set(["empty", "unknown"]);

/**
 * 单次探测就绪端点，回报四态。
 *
 * 为什么必须分开：Turbopack dev 偶发「会话级路由失效」（规范 §5 陈旧实例一族）
 * 时，`next` 进程活着、端口能应答，但 `/api/health` 这类路由不进编译图、直接
 * 404。旧的 `waitForReady` 只看 `res.ok`，把「404」和「连不上」都当成「还没就绪」
 * 一味空等，180s 到点后回收整棵树——用户看到的就是「卡住→应用自己没了」。
 * 把两者分开，编排器才能在「连上但持续 404」这一确切信号上做有界自愈。
 *
 * `schema-not-ready` 是同一个坑的第二种形态（实测现场）：服务活着、路由也在，
 * 但库是空的 / 表没建，`/api/health` 于是**恒返回 503**，而 503 过去被归进
 * 「普通未就绪」——启动器空等 180s、把结论说成「服务没起来」，用户完全看不到
 * 真正的原因（「跑 pnpm db:push」），只能对着空日志猜。单独成档之后，编排器
 * 能在超时**之前**就把这句可行动的话讲出来（见 `describeProbeState`）。
 *
 * @param {{ port: number, host?: string, path?: string }} spec
 * @returns {Promise<"ready" | "not-up" | "route-404" | "schema-not-ready">}
 */
export async function classifyProbe({
  port,
  host = "127.0.0.1",
  path: probePath = "/api/health",
}) {
  try {
    const res = await fetch(`http://${host}:${port}${probePath}`, {
      cache: "no-store",
    });
    if (res.ok) return "ready";
    // 拿到了 HTTP 应答但不是 2xx：404 是「路由没进编译图」的确切签名。
    if (res.status === 404) return "route-404";
    // 503 要看**响应体**才能定性：只有「表还没建」这一类不该被当成普通未就绪。
    if (res.status === 503 && (await healthBodySaysSchemaNotReady(res)))
      return "schema-not-ready";
    // 其余 4xx/5xx 不当成路由失效或建库问题（那是真故障，如 500），交回上层
    // 按普通未就绪继续等，避免把业务错误误读成缓存 / 建库问题。
    return "not-up";
  } catch {
    // fetch 抛异常 = 连不上（进程还没监听）——正常的「尚未就绪」。
    return "not-up";
  }
}

/** `/api/health` 的 503 响应体是不是「schema 没就绪」（读不到就按「不是」）。 */
/** @param {Response} res @returns {Promise<boolean>} */
async function healthBodySaysSchemaNotReady(res) {
  try {
    const body = await res.json();
    return SCHEMA_NOT_READY_DB.has(String(body?.db ?? ""));
  } catch {
    // 不是 JSON / 已经被读过：判不出就不下结论（按普通未就绪处理）。
    return false;
  }
}

/** 探测结论翻成给人看的一句话（失败出口里必须能读出「卡在哪一档」）。 */
/** @param {string} state @returns {string} */
export function describeProbeState(state) {
  switch (state) {
    case "ready":
      return "服务已就绪";
    case "route-404":
      return "服务已应答，但 /api/health 不在编译图里（陈旧路由表）";
    case "schema-not-ready":
      return "服务已应答，但数据库表还没建（/api/health 503，db=empty）";
    default:
      return "连不上服务（进程还没监听）";
  }
}

/**
 * 等 HTTP 就绪：有界重试，不需要 lsof/ss（直接问服务本身）。
 * @param {{ port: number, host?: string, timeoutMs?: number, path?: string,
 *           onTick?: ((secondsLeft: number) => void) | null, isAlive?: (() => boolean) | null }} spec
 * @returns {Promise<boolean>}
 */
export async function waitForReady({
  port,
  host = "127.0.0.1",
  timeoutMs = 180_000,
  path: probePath = "/api/health",
  onTick = null,
  isAlive = null,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAlive && !isAlive()) return false;
    if ((await classifyProbe({ port, host, path: probePath })) === "ready") {
      return true;
    }
    if (onTick) onTick(Math.round((deadline - Date.now()) / 1000));
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** 读文件尾部（失败诊断用；文件不存在返回空串）。 */
/**
 * @param {string} file @param {number} [lines] @returns {string}
 */
export function readTail(file, lines = 20) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .slice(-lines)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

/**
 * 文件里是否出现过某标记（大小写不敏感）。
 *
 * 用途：**收尾定性只认壳侧的「正标记」**。「壳也退出了」是一个共同现象，
 * 用户主动放弃、壳自己崩、被任务管理器结束都会命中它；由现象反推成因会把真
 * 故障说成设计内行为（历史事故），因此这里只提供「有没有写下这句话」的判据。
 * @param {string} file @param {string} marker
 * @returns {boolean}
 */
export function fileHasMarker(file, marker) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .toLowerCase()
      .includes(marker.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 应用服务输出的**转录文件**前缀（`nextjs-panel-<bootId>.log`）。
 *
 * 与 `src/lib/log/log-paths.ts` 的 `NEXTJS_PANEL_LOG_PREFIX` 同一口径：那份是
 * TS 侧（`server-only`），纯 Node 宿主（`scripts/*.mjs`）import 不了，所以这里
 * 保留一份字面量 —— 由 `tests/cross-platform-launcher.test.ts` 钉住两处一致。
 */
export const NEXTJS_PANEL_LOG_PREFIX = "nextjs-panel-";

/**
 * 目录里最新的一份应用服务转录文件；取不到返回 null。
 *
 * `since` 用于**排除上一次运行留下的文件**（按 mtime 判）：诊断只有一个用途，
 * 就是回答「这一次为什么失败」，把上一次的失败现场摆在用户面前比没有更坏。
 * @param {string} dir @param {{ prefix?: string, since?: number }} [options]
 * @returns {string | null}
 */
export function latestPanelTranscript(
  dir,
  { prefix = NEXTJS_PANEL_LOG_PREFIX, since = 0 } = {},
) {
  let best = null;
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
  } catch {
    return null; // 目录还不存在（应用服务从未启动过）——不是错误
  }
  for (const name of names) {
    const file = path.join(dir, name);
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue; // 正在被轮转删掉
    }
    if (mtimeMs < since) continue;
    if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
  }
  return best ? best.file : null;
}

/**
 * 失败诊断的取词顺序：**stderr → stdout → 应用服务转录**。
 *
 * 为什么不能用单一通道（ISSUE 实测，规范 §5）：
 *   · Next 的横幅与请求日志走 **stdout**，而超时分支过去只读 stderr —— 那里
 *     通常只有 pnpm 打印的一行脚本横幅，于是「最近输出」等于什么都没说，
 *     而同一现场 `nextjs-stdout-*.log` 里躺着 480 行、157 条 `503`；
 *   · 这两个重定向文件的行是**子进程直写 fd** 得到的，重定向文件在进程仍在写
 *     时可能读到 0 字节（实测：事后同一文件 31KB）；
 *   · 应用服务自己会同步追加一份转录（`nextjs-panel-*.log`，`appendFileSync`，
 *     随写随见），它是唯一在失败那一刻就**一定读得到**的通道。
 * 三者按「离失败最近、最不容易空」排序，取第一个非空结果。
 *
 * @param {{ stderrFile?: string | null, stdoutFile?: string | null,
 *           panelDir?: string | null, panelSince?: number, lines?: number }} spec
 * @returns {string} 诊断文本（三路都拿不到时为 ""，调用方自己给兜底文案）
 */
export function readDiagnosticsTail({
  stderrFile = null,
  stdoutFile = null,
  panelDir = null,
  panelSince = 0,
  lines = 20,
}) {
  const panel = panelDir
    ? latestPanelTranscript(panelDir, { since: panelSince })
    : null;
  for (const file of [stderrFile, stdoutFile, panel]) {
    if (!file) continue;
    const tail = readTail(file, lines);
    if (tail) return tail;
  }
  return "";
}

/** 端口归属：空闲 / 自己的残留 / 别人的。 */
export const PORT_OWNERSHIP = {
  free: "free",
  own: "own",
  foreign: "foreign",
};

/**
 * 端口归属判定（多检出并行保护，§1.4）。
 *
 * **只回收属于本检出的实例**：别的检出的 dev server、用户自己的程序占着端口时
 * 一律不碰 —— 判据不清时「猜着杀」比「说清楚怎么办」危险得多。
 * @param {number} port
 * @param {{ listenPids: (port: number) => Promise<number[]>,
 *           belongsToRoot: (pid: number, root: string) => Promise<boolean>,
 *           root: string }} deps
 * @returns {Promise<{ ownership: string, pids: number[], ownPids: number[], foreignPids: number[] }>}
 */
export async function inspectPort(port, { listenPids, belongsToRoot, root }) {
  const pids = await listenPids(port);
  if (pids.length === 0) {
    return {
      ownership: PORT_OWNERSHIP.free,
      pids,
      ownPids: [],
      foreignPids: [],
    };
  }
  const ownPids = [];
  const foreignPids = [];
  for (const pid of pids) {
    if (await belongsToRoot(pid, root)) ownPids.push(pid);
    else foreignPids.push(pid);
  }
  return {
    ownership: ownPids.length > 0 ? PORT_OWNERSHIP.own : PORT_OWNERSHIP.foreign,
    pids,
    ownPids,
    foreignPids,
  };
}

/**
 * 会不会由编排器把端口**显式传给** dev server（`pnpm dev -p <port>`）。
 *
 * 这是「回收残留实例」的必要前提：编排器的残留判据里有**两条子判据**，而它们
 * 只在「端口被显式指定」时才互不打脸（见 `portOwnershipVerdict`）。
 * @param {unknown} portOrNull 调用方解析出的端口（非整数即视为未指定）
 * @returns {boolean}
 */
export function usesExplicitPort(portOrNull) {
  return Number.isInteger(portOrNull) && /** @type {number} */ (portOrNull) > 0;
}

/** 应用服务自证身份用的探针（`pnpm dev` / `pnpm start` / `next dev` 都带它）。 */
export const APP_DEV_SCRIPT_MARKER = "dev.mjs";
/** 同一份自证里可能出现的第二个 token（standalone / e2e 的启动脚本）。 */
export const APP_START_SCRIPT_MARKER = "start.mjs";

/**
 * 端口占用者的归属裁定：本检出（应用服务）/ 本检出（其它）/ 别的检出或别的程序。
 *
 * 为什么要拆出「本检出（其它）」这一档：`pidBelongsToRoot` 只回答「这个 PID 的
 * 命令行里有没有出现过检出根路径」——`node_modules`、缓存路径、用户给的相对路径
 * 参数**都会**带出检出根，于是「其它程序恰好从本检出目录启动」与「本检出上次留下的
 * dev server」在旧判据下无法区分，而这两种情形的正确动作完全相反（前者绝不许杀）。
 * 应用服务多一条**自证**：命令行里有 `scripts/dev.mjs`（`dev`）/ `scripts/start.mjs`
 * （`start`，e2e）这类**本仓库的启动脚本**。这条自证不依赖任何状态文件 ——
 * 那些文件在 `log/` / `run/` 里，是就地重建的历史包袱（见 dev-launcher-session）。
 *
 * ⚠️ **只在「端口由编排器显式指定」时才产出自证结论**：编排器一律用
 * `pnpm dev -p <port>` 拉起 dev server（Next 不认 COMFYAPP_PORT，必须显式传），
 * 显式口上的服务只可能是编排器起的（用户手跑 `pnpm dev` 不经编排器 -- 见 §1.1）。
 * 未指定端口时（缺省解析链上的服务）无法区分「端口被显式指定的实例」与「用了
 * 缺省端口的实例」，自证就不再成立，一律不回收（宁放过，不杀错）。
 *
 * @param {{ requestedPort: number | null,
 *           verdict: { ownership: string, ownPids?: number[], foreignPids?: number[] },
 *           cmdlineOf: (pid: number) => Promise<string>,
 *           isAppProcess: (pid: number, cmdline: string) => boolean }} deps
 * @returns {Promise<{ ownership: string, ownPids: number[], foreignPids: number[], reclaimed: boolean }>}
 */
export async function portOwnershipVerdict({
  requestedPort,
  verdict,
  cmdlineOf,
  isAppProcess,
}) {
  // 空闲：没有占用者要裁。
  if (verdict.ownership === PORT_OWNERSHIP.free) {
    return {
      ownership: PORT_OWNERSHIP.free,
      ownPids: [],
      foreignPids: [],
      reclaimed: false,
    };
  }
  // 旧判据已经认定属本检出（`pidBelongsToRoot` 命中）：不需要自证，照旧回收。
  if (verdict.ownership === PORT_OWNERSHIP.own) {
    return {
      ownership: PORT_OWNERSHIP.own,
      ownPids: [...(verdict.ownPids ?? [])],
      foreignPids: [],
      reclaimed: true,
    };
  }
  // 剩下的是「别的进程」：只有**显式端口 + 应用服务自证**两条都满足才改判。两条里
  // 缺任何一条都原样返回——`ownPids` 必须留空，它是调用方唯一的回收依据，在这里
  // 顺手塞满就等于给「不回收」的结论配了一份「可以杀」的数据。
  if (!usesExplicitPort(requestedPort)) {
    return {
      ownership: PORT_OWNERSHIP.foreign,
      ownPids: [],
      foreignPids: [...(verdict.foreignPids ?? [])],
      reclaimed: false,
    };
  }

  const appPids = [];
  const restPids = [];
  for (const pid of verdict.foreignPids ?? []) {
    const cmdline = await cmdlineOf(pid);
    if (cmdline && isAppProcess(pid, cmdline)) appPids.push(pid);
    else restPids.push(pid);
  }
  if (appPids.length === 0) {
    return {
      ownership: PORT_OWNERSHIP.foreign,
      ownPids: [],
      foreignPids: restPids,
      reclaimed: false,
    };
  }
  return {
    ownership: PORT_OWNERSHIP.own,
    ownPids: appPids,
    foreignPids: restPids,
    reclaimed: true,
  };
}
