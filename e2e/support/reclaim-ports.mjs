/**
 * 「上一跑漏下的替身还占着端口」这一格的执行者：两条证据（命令行点名本仓替身脚本 + `/system_stats` 替身形状）齐了才动手，
 * 走 `killProcessTree` 收整棵树（单杀 leader 会留下 `sh -c` 下的 node，端口照占；成因是 `shell: true` 下收不到 teardown、节点复用）。
 * 只在 CI 档动（本地 `reuseExistingServer` 刻意复用）。判据见 `preflight-ports.mjs` 文件头；平台机制走 `launcher-core/procs.mjs` / `port-reap.mjs`。
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

/** 判据 ②：`/system_stats` 答出来是否替身形状；「答不出 / 不像」都算否，退回「不碰」（§1.4）。
 * @param {number} _pid
 * @param {{url?: string, timeoutMs?: number, probe?: (input: {url: string}) => Promise<{status:number, payload?:unknown}>}} [options]
 * @returns {Promise<boolean>} */
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

/** 收掉「上一跑漏下的替身」——认不够两条证据就不动；不抛，收不掉时 pre-flight 结论照旧说清现场。
 * @param {number} port 替身端口（`resolveFakeComfyuiPort()`）
 * @param {{readCmdlines?: (pids: number[]) => Promise<Map<number, string>>, answersFake?: (pid: number) => Promise<boolean>, listeningPids?: (port: number) => Promise<number[]>, reap?: (options: {pid: number, detached: boolean, force: boolean}) => Promise<unknown>, platform?: NodeJS.Platform}} [options] `readCmdlines` 收整批 PID（Windows 逐 PID 起 PowerShell 有 0.5~1.5s 冷启动，同 `port-reap.mjs` 处置）。
 * @returns {Promise<{reclaimed: number[], foreign: number[], free: boolean}>} */
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
    // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
    answers.set(pid, await answersFake(pid));
  }
  const own = pickOwnFakePids(pids, {
    cmdlineOf: (pid) => cmdlines.get(pid) ?? "",
    answersFake: (pid) => answers.get(pid) === true,
  });
  const foreign = pids.filter((pid) => !own.includes(pid));
  for (const pid of own) {
    // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
    await reap({ pid, detached: platform !== "win32", force: true });
  }
  return { reclaimed: own, foreign, free: false };
}

/* ── 应用端口上「上一跑漏下的**应用服务**」：与替身那一格同形、判据不同（ISSUE #1977 第十三处）──
 * 成因与替身逐字相同：`pnpm start` 挂在 webServer 的 `shell: true` 下，上一跑被 stage 墙钟 kill，teardown 没走、节点复用。
 * ⇒ next-server 留在端口上。判据换两条（都不新写，与 `reconcilePort` 同源）：① `isAppDevServerCmdline`（检出根 + 本仓脚本；
 * 进程标题被改成 `next-server` 时退 `pidBelongsToRoot` 的工作目录）② `/api/health` 的 `status` / `db` / `t` 三键形状。
 * 两条都要（只①会把别的检出的 dev server 当残留；只②收不了半死的服务）；只在 CI 档动，收完重算。 */

/** 本应用自证身份的探针端点（形状判据 ②）。**与 `playwright.config.ts` 的
 *  `url` 无关**：那个是「根路径可访问」，而这里要的是「它答得出本应用的响应」。 */
export const APP_HEALTH_PATH = "/api/health";

/**
 * 判据 ②：应用端口那个进程答出的 `/api/health` 是否本应用形状；连不上 / 非 200 / 非 JSON / 缺键算否，退回「不碰」（§1.4）。
 * 形状取 `status` / `db` / `t`：`src/app/api/health/route.ts` 的 200 与 503 都带；`db` 允许 `up` / `empty` / `unknown`（库没就绪仍是本应用）。
 * @param {number} port @param {{url?: string, timeoutMs?: number}} [options] @returns {Promise<boolean>}
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
 * 应用端口上的占位者里哪几个是**我们自己的应用服务**（两条证据都要）；同 `pickOwnFakePids` 的形状，只换判据。
 * @param {number[]} pids @returns {number[]}
 * @param {{cmdlineOf: (pid: number) => string, root: string, belongsToRoot: (pid: number) => boolean, answersApp: (pid: number) => boolean}} evidence —— 三者都已取好（同 `cmdlineOf`），可直接断言；`answersApp` 是端口级事实，对每个 PID 回同一值。
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
 * 收掉「我们上一跑漏下的应用服务」——认不够两条证据就不动；与 `reclaimOwnFakePort` 同处置（整棵树 / 认不出就不碰）。
 * @param {number} port 应用端口（`resolveAppPort(root)`） @param {string} root 检出根（`isAppDevServerCmdline` 判「是否本检出」）
 * @param {{readCmdlines?: (pids: number[]) => Promise<Map<number, string>>, answersApp?: (port: number) => Promise<boolean>, belongsToRoot?: (pid: number, root: string) => Promise<boolean>, listeningPids?: (port: number) => Promise<number[]>, reap?: (options: {pid: number, detached: boolean, force: boolean}) => Promise<unknown>, platform?: NodeJS.Platform}} [options] @returns {Promise<{reclaimed: number[], foreign: number[], free: boolean}>}
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
    // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
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
    // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
    await reap({ pid, detached: platform !== "win32", force: true });
  }
  return { reclaimed: own, foreign, free: false };
}

export { isFakeServerCmdline, classifyFakeSlot };
