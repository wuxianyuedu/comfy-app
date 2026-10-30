/**
 * 「上一跑漏下的替身还占着端口」这一格的**执行者**：认出它、收掉它、把结论记下来。
 *
 * ## 立案现场
 *
 * 平台上 `E2E 关键流程` 第二次真跑到最后一步时，日志第一次露出来，红在 Playwright
 * 自己的一句话上（`cnb-ooc-1k52laqqh`）：
 *
 *     [e2e-run] 起 Playwright 前：应用端口 空 / 替身端口 有人
 *     Error: http://127.0.0.1:18188/system_stats …（Playwright 报的「已有人应答」）
 *
 * （那句的原文还有后半截，给的是「确认没人跑 / 打开复用」两条出路 —— 本档两条都不采纳。）
 *
 * pre-flight 已经说了「替身端口在起 Playwright 之前就有人」，而 CI 档
 * `reuseExistingServer` 是 false ⇒ Playwright 直接抛，连会说清「谁在那儿」的
 * `globalSetup` 都到不了。占位者是**同一台自托管节点上上一跑漏下的替身**：
 * 它在 Playwright 的 webServer 里挂在 `shell: true` 那一层下面，流水线被取消时
 * 收不到 teardown，而节点是复用的。
 *
 * ## 判据与边界（都在 `preflight-ports.mjs` 的文件头写着，这里只做「怎么办」）
 *
 * **两条证据都要**（命令行点名本仓替身脚本 + `/system_stats` 是替身形状）才算
 * 「是我们自己的」，然后走 AGENTS 硬规则 3 的唯一出口 `killProcessTree` 收**整棵树**
 * （单杀 leader 会让 `sh -c` 下面那层 node 留着，端口照样占着 —— 那正是历史反复
 * 出现的形态）。**只在 CI 档动**：本地 `reuseExistingServer` 为真，Playwright 会复用，
 * 那是本地刻意留的方便，不该被这一步悄悄改成「杀掉重启」。
 *
 * ⚠️ **平台机制不在这里手写**：端口上是谁、命令行是什么、怎么杀整棵树，三件都走仓里
 * 已有的那几处唯一实现（`launcher-core/procs.mjs` 与 `launcher-core/port-reap.mjs`），
 * 本模块只负责把它们串成本档的一步。自己写一份 `netstat` / `taskkill` 就是第四次
 * 踩同一个坑（见硬规则 3 与 §2.1.1）。
 */
import {
  listeningPidsOnPort,
  pidBelongsToRoot,
  processCommandLines,
} from "../../scripts/launcher-core/procs.mjs";
import { isAppDevServerCmdline, reapProcessTree } from "../../scripts/launcher-core/port-reap.mjs";
import { isFakeServerCmdline, pickOwnFakePids } from "./preflight-ports.mjs";
import {
  classifyFakeSlot,
  fakeComfyuiStatsUrl,
  isFakeComfyuiPayload,
} from "./fake-comfyui-endpoint.mjs";

/**
 * 某个 PID 此刻答出来的 `/system_stats` 是不是替身形状（判据 ②）。
 *
 * 「答不出来」与「答出来不像」都算**否**：这一步要的是「此刻它确实是那个东西」，
 * 拿不到就退回「不碰」（`foreign`），宁放过不杀错（§1.4）。
 *
 * @param {number} _pid
 * @param {{url?: string, timeoutMs?: number, probe?: (input: {url: string}) => Promise<{status:number, payload?:unknown}>}} [options]
 * @returns {Promise<boolean>}
 */
export async function isFakeServerAnswering(_pid, options = {}) {
  const url = options.url ?? fakeComfyuiStatsUrl();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    if (res.status !== 200) {
      return false;
    }
    return isFakeComfyuiPayload(await res.json());
  } catch {
    return false;
  }
}

/**
 * 收掉「我们上一跑漏下的替身」——**认不够两条证据就不动**。
 *
 * 返回值只回答「这一步做了什么」，不抛：收不掉（权限 / 进程已在退）时上面那条
 * pre-flight 结论照旧把现场说清，`globalSetup` 与 Playwright 的话术都还在。
 *
 * @param {number} port 替身端口（`resolveFakeComfyuiPort()` 给的那一个）
 * @param {{readCmdlines?: (pids: number[]) => Promise<Map<number, string>>,
 *          answersFake?: (pid: number) => Promise<boolean>,
 *          listeningPids?: (port: number) => Promise<number[]>,
 *          reap?: (options: {pid: number, detached: boolean, force: boolean}) => Promise<unknown>,
 *          platform?: NodeJS.Platform}} [options]
 *   `readCmdlines` 收**整批 PID** 而不是逐个（Windows 上逐 PID 起一次 PowerShell 是
 *   0.5~1.5s 的冷启动，批量一条 CIM 查询就够 —— 与 `port-reap.mjs` 同一处置）。
 * @returns {Promise<{reclaimed: number[], foreign: number[], free: boolean}>}
 */
export async function reclaimOwnFakePort(port, options = {}) {
  const listPids = options.listeningPids ?? listeningPidsOnPort;
  const readCmdlines = options.readCmdlines ?? processCommandLines;
  const answersFake = options.answersFake ?? isFakeServerAnswering;
  const reap = options.reap ?? reapProcessTree;
  const platform = options.platform ?? process.platform;
  const pids = await listPids(port);
  if (pids.length === 0) {
    return { reclaimed: [], foreign: [], free: true };
  }

  const cmdlines = await readCmdlines(pids);
  /* 判据 ② 是**异步的**（问那个进程的 `/system_stats`），所以先只对「命令行走形的那几个」
   * 付这次代价 —— 一个不相关的占位者不必被 fetch 一遍。 */
  const byCmdline = pids.filter((pid) => isFakeServerCmdline(cmdlines.get(pid) ?? ""));
  const answers = new Map();
  for (const pid of byCmdline) {
    answers.set(pid, await answersFake(pid));
  }
  const own = pickOwnFakePids(pids, {
    cmdlineOf: (pid) => cmdlines.get(pid) ?? "",
    answersFake: (pid) => answers.get(pid) === true,
  });
  const foreign = pids.filter((pid) => !own.includes(pid));
  for (const pid of own) {
    await reap({ pid, detached: platform !== "win32", force: true });
  }
  return { reclaimed: own, foreign, free: false };
}

/* ── 应用端口上「上一跑漏下的**应用服务**」：与替身那一格同形、判据不同 ──
 *
 * ## 立案现场（ISSUE #1977 第十三处）
 *
 * 替身那一格修好之后（`reclaimOwnFakePort`），`E2E 关键流程` 又红在同一句话上，
 * 只是这次占的是**应用端口**（`cnb-p0k-1k52srtjv`，日志已经能流式读到了）：
 *
 *     [e2e-run] 起 Playwright 前：应用端口 有人 / 替身端口 有人
 *     [e2e-run] 替身端口 18188 上坐着本检出上一跑漏下的替身（PID …），已回收整棵树
 *     …
 *     `Error: http://localhost:3989 is already used, make sure that nothing is`
 *     `       running on the port/url or set reuseExistingServer:true`
 *
 * 成因与替身那一格**逐字相同**：`pnpm start` 是 Playwright webServer 起的，挂在
 * `shell: true` 那一层下面（孙子进程），而**上一跑是被 stage 墙钟 kill 的**
 * （36 分钟超时那次）—— teardown 那条路根本没走，于是 next-server 留在端口上，
 * 节点是复用的。（两处同源、不同对象：替身是第二个 webServer，应用是第一个。）
 *
 * ## 判据：与替身那一格同一条思路，但**换两条证据**
 *
 * 替身那两条是「命令行点名本仓替身脚本」+「`/system_stats` 是替身形状」；应用这一格
 * 对应的是：
 *   ① **命令行是本检出应用服务的自证**（`isAppDevServerCmdline`：命令行同时含
 *      **检出根路径**与 `scripts/dev.mjs` / `scripts/start.mjs` / `next dev|start`）
 *      —— 仓里已有这一处唯一实现，**不另写一份**（§12.18；它正是 `reconcilePort`
 *      那条回收路径用的判据）；
 *   ② **它此刻答出来的 `/api/health` 是本应用的形状**（`status` / `db` / `t` 三个键）。
 *
 * ⚠️ 两条都要：
 *   · 只判 ①，会把**别的检出**正在跑的 dev server 当成残留（§1.4 多检出并行保护）——
 *     ①能认出「是本仓的应用服务」，但**认不出是哪一份检出**（两条不同路径的检出各跑
 *     一个 e2e 时，命令行同样命中）；②把「此刻它是一个在应答的本应用」补上，两条一起
 *     才是「这是我们自己的」；
 *   · 只判 ②，收不了一个**半死**的应用服务（答不出形状，而端口照样占着）。
 *     这一格与替身那处**刻意不同**：那里要求「答得出形状」，这里也要求 —— 但**应用
 *     半死的概率低于替身**（替身只有 `/system_stats` 一个端点，应用有整套路由），
 *     所以这里不额外放宽；两条都拿不到就退回「不碰」。
 *
 * ⚠️ **① 是「两条并列的判据」而不是只有命令行**（实测逼出来的）：监听端口的那个进程
 * 是 Next 起的 **`next-server`**，而它会**改写自己的进程标题** —— 命令行与
 * `/proc/<pid>/cmdline` 两头都只剩 `next-server (v16.3.8)`，「含检出根 + 本仓脚本」
 * 那条判据在它身上自然为假（Linux 检出实测）。所以 ① 取**两条之一即可**：
 *   · `isAppDevServerCmdline(cmdline, root)`（含检出根 + 本仓 `dev.mjs` / `start.mjs` /
 *     `next dev|start`）—— Windows 上 CIM 拿到的真实命令行走这一条；
 *   · `pidBelongsToRoot(pid, root)`（**工作目录**落在检出根下）—— 标题被改写的进程
 *     只剩这一条线索，而两个平台都拿得到（`launcher-core/procs.mjs` 的既有出口）。
 *
 * 两条都不是新判据、也不是第二份实现：它们正是 `reconcilePort`（编排器回收残留实例）
 * 用的那两条，这里只是把它们并列（§12.18）。
 *
 * ## 只在 CI 档动，且**收完要重算**
 *
 * 与替身那一格逐字同一条边界：本地 `reuseExistingServer` 为真、Playwright 会复用，
 * 不该被这一步悄悄改成「杀掉重启」；收完 `e2e-run.mjs` 会把 pre-flight 结论重算
 * 一遍（带进 `globalSetup` 的必须是「起 Playwright 之前」的事实）。
 */

/** 本应用自证身份的探针端点（形状判据 ②）。**与 `playwright.config.ts` 的
 *  `url` 无关**：那个是「根路径可访问」，而这里要的是「它答得出本应用的响应」。 */
export const APP_HEALTH_PATH = "/api/health";

/**
 * 应用端口上那个进程此刻答出来的 `/api/health` 是不是**本应用**的形状（判据 ②）。
 *
 * 「连不上 / 不是 200 / 不是 JSON / 缺键」都算**否** —— 拿不到就退回「不碰」，
 * 宁放过不杀错（§1.4）。
 *
 * 形状取 `status` / `db` / `t` 三个键：`src/app/api/health/route.ts` 两条分支
 * （200 与 503）都带这三个；`db` 允许是 `up` / `empty` / `unknown`（库没就绪时
 * 这一格照样是**本应用**，且那正是 E2E 前置会拦的另一种状态）。
 *
 * @param {number} port
 * @param {{url?: string, timeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export async function isAppAnswering(port, options = {}) {
  /* `url` 只给「基址」（用例注入一个必然连不上的地址用），**端口默认从入参来** ——
   * 这是本模块与 `isFakeServerAnswering` 唯一的结构差别：那一格的端口藏在
   * `fakeComfyuiStatsUrl()` 里（替身只有一个落点），应用这一格的端口是**运行时
   * 解析出来的**（按检出路径推导），不能另找一处硬编码。 */
  const base = options.url ?? `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}${APP_HEALTH_PATH}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    /* 503（库没就绪）也是本应用的应答 —— 只认「它答得出这个形状」。 */
    if (res.status !== 200 && res.status !== 503) {
      return false;
    }
    const body = await res.json();
    return (
      !!body &&
      typeof body === "object" &&
      typeof body.status === "string" &&
      typeof body.db === "string" &&
      typeof body.t === "string"
    );
  } catch {
    return false;
  }
}

/**
 * 应用端口上那些占位者里，哪几个是**我们自己的应用服务**（两条证据都要）。
 *
 * 与 `pickOwnFakePids` 同形（纯函数：两条证据都取好了再喂进来），差别只在判据本身。
 *
 * @param {number[]} pids
 * @param {{cmdlineOf: (pid: number) => string, root: string,
 *          belongsToRoot: (pid: number) => boolean,
 *          answersApp: (pid: number) => boolean}} evidence
 *   `belongsToRoot` 与 `answersApp` 都**已经取好**再喂进来（与 `cmdlineOf` 同一形状），
 *   所以这条判据能被直接断言、不必真起进程。`answersApp` 是**端口级**的事实：
 *   调用方探一次，这里对每个 PID 都回同一个值（判据问的是「那个口上坐着的
 *   是不是一个在应答的本应用」）。
 * @returns {number[]}
 */
export function pickOwnAppPids(pids, evidence) {
  return pids.filter(
    (pid) =>
      (isAppDevServerCmdline(evidence.cmdlineOf(pid), evidence.root) ||
        evidence.belongsToRoot(pid)) &&
      evidence.answersApp(pid),
  );
}

/**
 * 收掉「我们上一跑漏下的应用服务」——**认不够两条证据就不动**。
 *
 * 与 `reclaimOwnFakePort` 同一处置（收整棵树、认不出来就退回「不碰」），
 * 区别只在判据与 `root` 这个入参（`isAppDevServerCmdline` 要用它判「是不是本检出」）。
 *
 * @param {number} port 应用端口（`resolveAppPort(root)` 给的那一个）
 * @param {string} root 检出根
 * @param {{readCmdlines?: (pids: number[]) => Promise<Map<number, string>>,
 *          answersApp?: (port: number) => Promise<boolean>,
 *          belongsToRoot?: (pid: number, root: string) => Promise<boolean>,
 *          listeningPids?: (port: number) => Promise<number[]>,
 *          reap?: (options: {pid: number, detached: boolean, force: boolean}) => Promise<unknown>,
 *          platform?: NodeJS.Platform}} [options]
 * @returns {Promise<{reclaimed: number[], foreign: number[], free: boolean}>}
 */
export async function reclaimOwnAppPort(port, root, options = {}) {
  const listPids = options.listeningPids ?? listeningPidsOnPort;
  const readCmdlines = options.readCmdlines ?? processCommandLines;
  const answersApp = options.answersApp ?? isAppAnswering;
  const inRoot = options.belongsToRoot ?? pidBelongsToRoot;
  const reap = options.reap ?? reapProcessTree;
  const platform = options.platform ?? process.platform;
  const pids = await listPids(port);
  if (pids.length === 0) {
    return { reclaimed: [], foreign: [], free: true };
  }

  const cmdlines = await readCmdlines(pids);
  /* ① 的两条线索各取一次（命令行一次批量查、工作目录一次按 PID：
   * `pidBelongsToRoot` 内部就是「取 cwd 比字符串」，POSIX 读 `/proc/<pid>/cwd`、
   * Windows 走同名系统调用 —— 与 `reconcilePort` 同一条路）。 */
  /** @type {number[]} */
  const candidates = [];
  for (const pid of pids) {
    const cmdline = cmdlines.get(pid) ?? "";
    if (isAppDevServerCmdline(cmdline, root) || (await inRoot(pid, root))) {
      candidates.push(pid);
    }
  }
  /* ② 是**端口级**的事实（那个口上的服务答不答得出本应用的响应），不是逐 PID 的 ——
   * 所以只探一次，而且只在 ① 命中过时才探（不相关的占位者不必被 fetch 一遍）。
   * ⚠️ 入参是**端口**不是 PID：判据问的是「这个口上坐着的是不是一个在应答的本应用」，
   * 而端口上可能同时有好几层进程（`pnpm` / `node start.mjs` / `next-server`）。 */
  const answersAppOnPort = candidates.length > 0 ? await answersApp(port) : false;
  const own = pickOwnAppPids(pids, {
    cmdlineOf: (pid) => cmdlines.get(pid) ?? "",
    root,
    belongsToRoot: (pid) => candidates.includes(pid),
    answersApp: () => answersAppOnPort,
  });
  const foreign = pids.filter((pid) => !own.includes(pid));
  for (const pid of own) {
    await reap({ pid, detached: platform !== "win32", force: true });
  }
  return { reclaimed: own, foreign, free: false };
}

export { isFakeServerCmdline, classifyFakeSlot };
