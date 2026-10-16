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
  processCommandLines,
} from "../../scripts/launcher-core/procs.mjs";
import { reapProcessTree } from "../../scripts/launcher-core/port-reap.mjs";
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
    if (res.status !== 200) return false;
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
  if (pids.length === 0) return { reclaimed: [], foreign: [], free: true };

  const cmdlines = await readCmdlines(pids);
  /* 判据 ② 是**异步的**（问那个进程的 `/system_stats`），所以先只对「命令行走形的那几个」
   * 付这次代价 —— 一个不相关的占位者不必被 fetch 一遍。 */
  const byCmdline = pids.filter((pid) =>
    isFakeServerCmdline(cmdlines.get(pid) ?? ""),
  );
  const answers = new Map();
  for (const pid of byCmdline) answers.set(pid, await answersFake(pid));
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

export { isFakeServerCmdline, classifyFakeSlot };
