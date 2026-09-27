// ComfyUI 运行态快照：给设置页 / 状态「更及时、更准」的判据。
//
// 背景（ISSUE #339）：外部（Comfy 桌面版、自己的终端）已经拉起 ComfyUI，
// 设置页却仍显示「未运行」，或打开页面要等十几秒才跳到「运行中」。
// 根因有三处，都在「拿事实」的这一步：
//   ① 判据过重：只认 `resolveComfyBase()` 那条链——comfyuiPath 配错 / 指向
//      venv 启动器时 `main.py` 命令行匹配必然落空（Comfy Desktop 的
//      standalone-env 用 `uv` 启动，命令行里没有 `main.py`），此前的实现
//      直接抛「Configured instance is not running」，外部实例明明在跑也报未运行；
//   ② 探测无缓存：状态查询每次都重新付一遍 PowerShell 进程表查询 + 6 次
//      端口扫描，叠加 tRPC 批处理时能慢到数秒，状态行先渲染「未运行」再跳；
//   ③ 缓存不失效：`client.ts` 里 `_resolvedBase` 记住一次结果就永不复查，
//      外部实例新起来后仍然沿用旧结论。
//
// 本模块把这些收敛成一次「进程级快照」：
//   - 事实来自 OS 进程表（该跑 ComfyUI 的解释器进程有没有活着），不要求
//     必须先 HTTP 探测成功——外部实例刚起来、模型还没加载完时也能立刻判「在跑」；
//   - 结果带短 TTL 缓存 + 在途去重（single-flight）：连点刷新 / tRPC 批处理里的
//     并发查询只走一次 IO，冷缓存也能秒回；
//   - 命中后不动 `_resolvedBase`（不污染其它链路），只把「这份快照认得哪个
//     实例」记下来，供打开界面 / 诊断用。
//
// 与 `probeComfyUi`（lifecycle）的分工：那个是「能不能立刻用它」的严格判据
// （HTTP 必须通），本模块是「进程在不在」的快速判据。设置页两者都看。
//
// 判据链（任一级命中即「在跑」，逐级放宽）：
//   ① bound 子进程（本进程亲手拉起，PID 直接可信）；
//   ② 配置路径的 main.py（进程命令行匹配）；
//   ③ setup 登记的启动器 / 配置路径的解释器候选；
//   ④ 环境反查：`standalone-env\pyvenv.cfg` 的 home/executable 与 uv 托管
//      目录下的解释器（Comfy Desktop 由 uv 起、解释器常不在实例根，
//      见 env-python.ts）。

import { errorText } from "~/lib/error-message";
// §18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批·汇聚点）。
// 静态依赖——`~/lib/error-message` / `fs` / `path` /
// `../app-settings/app-settings.server`（`.server` 后缀、内部无 server-only） /
// `../endpoints` / `./launch-path` / `./instance-kind` / `./proc-detect` /
// `~/lib/shell/tracing-ignore` / `./probe` / `./env-python` /
// `~/lib/core/logger`（经 `app-runtime-log` #1075 + `log-paths` #1074 通链）
// —— 在前 8 批 comfyui 与 lib 层地基批完成之后**全部**纯 Node 可加载。
// 登记进 `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
import fs from "fs";
import path from "path";
import { getSettingsSync } from "../app-settings/app-settings.server";
import { COMFYUI_DEFAULT_PORT } from "../endpoints";
import { resolveComfyLaunchPlan } from "./launch-path";
import { classifyComfyInstall } from "./instance-kind";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";
import { probeComfyAtPort } from "./probe";
import { collectComfyPythonCandidates } from "./env-python";
import { logger } from "~/lib/core/logger";

/** 进程/端口事实的快照：拿不到就都为空。 */
export type ComfyRuntimeSnapshot = {
  /** 有 ComfyUI 进程在跑（本进程拉起的、配置路径的、或任意解释器起的）。 */
  running: boolean;
  /** 从进程表定位到的 PID（拿不到为 null）。 */
  pid: number | null;
  /** PID 正在监听的端口（拿不到为 null）。 */
  port: number | null;
  /** 该进程用什么起的（中文短语，如「setup 中登记的启动器」），用于状态行提示。 */
  via: string | null;
  /** 进程表查询本身是否失败（超时/无权限）：结果不可信，不得当作「没在跑」。 */
  unverified: boolean;
  /** 本次是否**真的查过**进程表。
   *
   *  与 `unverified` 不同：`unverified` 只说「没有一条事实可信」，而 0 条候选
   *  时既不失败也一条都问不到，两者都是「false + unverified=false」——上层
   *  据此把「没启动」坐实成「未运行」，于是启动等待期里的瞬时结论被照单全收，
   *  状态行在「启动中」与「未运行」之间来回跳（ISSUE #442）。
   *  取值同上：命中任一候选（含 bound 子进程 / 配置端口上的实例）即算查过——
   *  「端口有人应答」是比进程表更强的证据，不必再枚举一遍进程。 */
  didQueryProcTable: boolean;
  /** 事实来源：bound=本进程持有的子进程；port=配置端口上已有人应答；
   *  process=配置路径进程表命中；launcher=setup 登记启动器；any=按环境反查
   *  （pyvenv.cfg / uv 托管解释器）出来的解释器进程。 */
  source: "bound" | "port" | "process" | "launcher" | "any" | null;
};

/** 快照缓存时长：探针自身很快（见探针设计），缓存只为吸收「连点刷新 /
 *  并发查询」的重复 IO，不做长 TTL——外部实例刚起来时最多等这么久被认出来。 */
export const COMFY_SNAPSHOT_TTL_MS = 1_500;

/** 未绑定端口的快照（「进程在、接口还没就绪」）的缓存时长：比普通 TTL 更短。
 *
 *  这类快照的含义是「正在启动」，而正在启动的下一步就是绑定端口——状态行
 *  必须尽快翻成「运行中」。若沿用 1.5s TTL，设置页的 5s 轮询有相当概率连着
 *  两次都命中同一份「端口未绑定」缓存，用户看到的就是「明明起来了还显示
 *  启动中」（ISSUE #344）。 */
export const COMFY_UNBOUND_PORT_TTL_MS = 0;

type SnapshotGlobal = {
  cached?: { at: number; snap: ComfyRuntimeSnapshot };
  inflight?: Promise<ComfyRuntimeSnapshot>;
};

declare global {
  var __comfyRuntimeSnapshot_v1: SnapshotGlobal | undefined;
}

const st: SnapshotGlobal = (globalThis.__comfyRuntimeSnapshot_v1 ??= {});

/** 该快照是否属于「正在启动」：进程在跑、但监听端口还没出现。
 *  这种结论到期极快（见 COMFY_UNBOUND_PORT_TTL_MS），否则会把状态行按在
 *  「启动中」上不动。 */
function isUnboundPortSnapshot(snap: ComfyRuntimeSnapshot): boolean {
  return snap.running && snap.port === null;
}

/** 该快照在 `now` 时刻是否已过有效期。 */
function isStale(snap: ComfyRuntimeSnapshot, at: number, now: number): boolean {
  const ttl = isUnboundPortSnapshot(snap)
    ? COMFY_UNBOUND_PORT_TTL_MS
    : COMFY_SNAPSHOT_TTL_MS;
  return now - at >= ttl;
}

/** 不带快照的空结果。 */
function emptySnapshot(): ComfyRuntimeSnapshot {
  return {
    running: false,
    pid: null,
    port: null,
    via: null,
    unverified: false,
    didQueryProcTable: false,
    source: null,
  };
}

/** 本进程持有的子进程（bound 模式）：最可靠的事实，优先于任何查询。
 *
 * 读的是 lifecycle 挂在 globalThis 上的会话状态（HMR 单例）；`__comfyLifecycle_v1`
 * 由 `./lifecycle.ts` 的 `declare global` 定义，这里直接以它的类型读子段的 `child?.pid`，
 * 不再本地重抄一份 ChildHolder 形状 + `as unknown as` 单跳。测试可用
 * `setBoundChildPidReader` 注入桩，避免为一条判据去搭真实子进程。
 */
let readBoundChildPid: () => number | null = () => {
  const pid = globalThis.__comfyLifecycle_v1?.child?.pid;
  return typeof pid === "number" && pid > 0 ? pid : null;
};

/** 测试注入点：替换「本进程 bound 子进程 PID」的读取方式。 */
export function setBoundChildPidReader(reader: () => number | null): void {
  readBoundChildPid = reader;
}

function boundChildPid(): number | null {
  return readBoundChildPid();
}

/** 从进程表里找「命令行含 main.py 的解释器」。仓库里三处启动路径的候选顺序
 *  一致（便携 → venv → 桌面 standalone-env），这里作为兜底再放宽一层。 */
export function launcherCommandCandidates(pythonExe: string): string[] {
  const dir = path.dirname(pythonExe);
  const exts =
    process.platform === "win32"
      ? ["pythonw.exe", "python.exe"]
      : ["pythonw", "python"];
  // 去重：便携版解释器本身就叫 python.exe，枚举结果与候选重复时不必查两遍。
  return [
    ...new Set([
      ...exts.map((name) => path.join(...tracingIgnoreArgs(), dir, name)),
      pythonExe,
    ]),
  ];
}

/** 读 setup 登记的启动器（ComfyUI 的 `comfy-cli` 会把「怎么起这个实例」写到
 *  `.venv/Lib/site-packages/comfy_cli/.comfy-cli` 的 setup 节）。只在
 *  comfyuiPath 存在且是目录时读一次，读不到返回 null（纯尽力而为）。 */
export function readRegisteredLauncher(comfyuiPath: string): string | null {
  if (!comfyuiPath) return null;
  const registry = path.join(
    ...tracingIgnoreArgs(),
    comfyuiPath,
    ".venv",
    "Lib",
    "site-packages",
    "comfy_cli",
    ".comfy-cli",
  );
  let raw: string;
  try {
    raw = fs.readFileSync(...tracingIgnoreArgs(), registry, "utf8");
  } catch {
    // 兜底：comfyuiPath 本身就是注册表文件（少见，但比「静默不认」好）。
    try {
      raw = fs.readFileSync(...tracingIgnoreArgs(), comfyuiPath, "utf8");
    } catch {
      return null;
    }
  }
  // 取 setup 节的 cmds（形如 "cmds": "C:\...\python.exe main.py"）。走 JSON.parse
  // 而不是正则：cmds 内嵌的引号是 JSON 转义过的（`\"C:\\uv...\"`），正则抓不准。
  const cmds = extractSetupCmds(raw);
  if (!cmds) return null;
  const first = /^"([^"]+)"/.exec(cmds)?.[1] ?? cmds.trim().split(/\s+/)[0];
  if (!first || !/\.exe$|python/i.test(first)) return null;
  return first;
}

/** 从 .comfy-cli 内容里取 setup.cmds；结构不认识时返回 null（静默降级）。 */
export function extractSetupCmds(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const setup = (parsed as { setup?: { cmds?: unknown } })?.setup;
    const cmds = setup?.cmds;
    return typeof cmds === "string" && cmds.trim() ? cmds : null;
  } catch {
    return null;
  }
}

/** 设置里的 ComfyUI 监听端口（0 = 未配置 → 平台默认 8188）。
 *
 * 快照的「配置端口抢跑」要用它：绝大多数实例就监听在这里，探一下就能跳过
 * 一次「定位 PID 监听端口」的系统查询（见 {@link resolvePortFast}）。 */
function configuredPortOf(settings: { comfyuiPort?: number }): number {
  const p = settings.comfyuiPort ?? 0;
  return p > 0 ? p : COMFYUI_DEFAULT_PORT;
}

/** 定位某个 PID 实际监听的端口，**并用「配置端口是否应答」抢跑**。
 *
 * 为什么需要抢跑：定位 PID 的监听端口在 Windows 上要另起一次系统查询，而它
 * 前面那次「找 main.py」的进程表查询也是秒级——两次串起来就是「ComfyUI 明明
 * 已经在跑，设置页还要等一会才显示运行中」。
 *
 * 但绝大多数实例就监听在配置端口上。于是这里同时做两件事：
 *   ① `findPidListeningPort(pid)` —— 权威答案（能认出端口偏移的实例）；
 *   ② 探一下配置端口 —— 便宜（环回地址毫秒级应答）且几乎总是对的。
 * 谁先给出可信结果就用谁：配置端口应答 + 进程在跑，等价于「实例在跑且就在这个
 * 端口」。①随后返回时若给出不同的端口，说明实例确实偏移过端口，那时①已经
 * 赢在「更权威」上是不成立的——所以我们只在①尚未出结果时才采信②，
 * 避免用「猜的端口」覆盖「查出来的端口」。
 *
 * `alreadyProbedPort` 是调用方已经探过配置端口的结果（`null` = 刚探过、没人
 * 应答）。否则同一件事会被连探两次，而每次探测的失败路径都要等满 1.5s 超时
 * ——「没在跑」的主场景下这就是白加的一整条链（见 `snapshotOnce` 步骤 1.5）。
 */
async function resolvePortFast(
  pid: number,
  configuredPort: number,
  alreadyProbedPort: boolean | null = null,
): Promise<number | null> {
  const authoritative = findPidListeningPort(pid);
  if (!configuredPort) return authoritative;

  if (alreadyProbedPort === false) {
    /* 配置端口刚被探过且没人应答 → 抢跑这一路已经出局，直接等权威查询。
     * 不重探的另一个理由同「不做无谓 IO」：探失败要等满超时。 */
    return authoritative;
  }

  const guessed =
    alreadyProbedPort === true
      ? Promise.resolve(configuredPort)
      : probeComfyAtPort(configuredPort).then((base) =>
          base ? configuredPort : null,
        );
  const winner = await Promise.race([
    authoritative.then((port) => ({ port })),
    guessed.then((port) => ({ port })),
  ]);
  if (winner.port) return winner.port;
  // 抢跑没结论（配置端口没人应答）→ 仍以权威查询为准。
  return authoritative;
}

async function snapshotOnce(): Promise<ComfyRuntimeSnapshot> {
  const settings = getSettingsSync();

  // 1) bound 子进程：本进程亲手拉起的，PID 直接可信（无需查进程表）。
  const bound = boundChildPid();
  if (bound) {
    const port = await resolvePortFast(bound, configuredPortOf(settings));
    return {
      running: true,
      pid: bound,
      port,
      via: "本应用启动的进程",
      unverified: false,
      didQueryProcTable: true,
      source: "bound",
    };
  }

  const comfyuiPath = settings.comfyuiPath?.trim() ?? "";
  if (!comfyuiPath) return emptySnapshot();

  // 1.5) 配置端口已经有人应答 → 直接认「在跑」，跳过其余三次进程表查询。
  //
  // 为什么这条要插在进程表判据之前：一个只认 localhost 的实例如果**真的**在运行，
  // 它监听的端口已经把这个事实答出来了——再去枚举 Win32_Process 与 uv 托管目录，
  // 换来的是同一句「在跑」，代价却是冷启动高负载下的秒级等待。而「是不是**我们要的
  // 那个**实例」这个问题本来就不由本快照回答（判据链第 4 级按环境反查本来就是
  // 「任意解释器起的 ComfyUI」），所以这里不改变结论的语义，只把已有的最后一级
  // 判据在本机最常见的形态（实例就在默认/配置端口上）上做成了死路。
  //
  // 端口上**没有人应答**才继续往下走：这才是「没在跑」的主场景（进程表查询与端口
  // 扫描此时仍必须全跑一遍，否则外部实例的端口偏移会被漏掉）。
  const configuredPort = configuredPortOf(settings);
  const configuredPortUp = (await probeComfyAtPort(configuredPort)) !== null;
  if (configuredPortUp) {
    return {
      running: true,
      pid: null,
      port: configuredPort,
      via: "配置端口上的实例",
      unverified: false,
      didQueryProcTable: true,
      source: "port",
    };
  }

  // 查询失败≠没在跑（高负载 / 冷启动时 PowerShell 常超时）：如实记下来，
  // 最终没命中任何判据时标 unverified，绝不在这里下「未运行」的结论。
  // 注意不能在这里提前 return——「这一条查不到」恰恰是第 3、4 级存在的理由
  // （Comfy Desktop 由 uv 起，main.py 那一路必然落空）。
  let lookupFailed = false;

  // 2) 配置路径的 main.py：进程表命中即「在跑」（即使 HTTP 还没就绪）。
  const plan = resolveComfyLaunchPlan(comfyuiPath);
  if (!("error" in plan)) {
    const lookup = await findPidForMainPyDetailed(plan.mainPy);
    if (lookup.pid) {
      return {
        running: true,
        pid: lookup.pid,
        port: await resolvePortFast(
          lookup.pid,
          configuredPort,
          configuredPortUp,
        ),
        via: "配置路径的实例",
        unverified: false,
        didQueryProcTable: true,
        source: "process",
      };
    }
    if (lookup.failed) lookupFailed = true;
  }

  // 3) 启动器形态：Comfy Desktop 的 standalone-env 由 uv 启动，命令行里没有
  //    main.py（步骤 2 必然落空）；先试 setup 登记的启动器，再试解释器候选。
  const classify = classifyComfyInstall(comfyuiPath);
  const registered = readRegisteredLauncher(
    classify.instanceRoot ?? comfyuiPath,
  );
  const candidates: { cmd: string; via: string }[] = [];
  if (registered)
    candidates.push({ cmd: registered, via: "setup 中登记的启动器" });
  if (!("error" in plan)) {
    for (const cmd of launcherCommandCandidates(plan.cmd)) {
      candidates.push({ cmd, via: "配置路径的解释器" });
    }
  }
  // 4) 环境反查兜底：Comfy Desktop 的 standalone-env 常由 uv 的托管解释器
  //    创建（解释器落在 `%LOCALAPPDATA%\uv\python\cpython-*`），步骤 3 按
  //    「实例根下的解释器路径」查表必然落空。这里顺着 `standalone-env\pyvenv.cfg`
  //    的 home/executable 找到真正在跑的解释器，再补一遍 uv 托管目录
  //    （见 env-python.ts）。命中即 source=any，仍不等 HTTP。
  for (const c of collectComfyPythonCandidates(
    classify.instanceRoot ?? comfyuiPath,
  )) {
    candidates.push({ cmd: c.exe, via: c.via });
  }

  /* 候选**并发**查进程表，而不是一个个 await 串起来。
   *
   * 这批候选是「同一件事的几种问法」（配置路径的解释器 / setup 登记的启动器 /
   * 环境反查出的解释器），彼此无依赖，真正命中的通常只有一个。此前串行 await
   * 会把冷启动的等待叠成 N 倍：每次 `findPidForMainPyDetailed` 都要起一个
   * PowerShell 枚举 `Win32_Process`（本机 ~2.5s，超时给到 10s），三个候选就是
   * 7s+，而这段时间纯粹在排队——用户的观感就是「设置页打开要等一会才显示
   * ComfyUI 运行中」。并发之后整批只付最慢那一次（ISSUE #339 残留延迟）。
   *
   * 命中后按候选**原始顺序**取第一个：几路同时命中时，仍由「先声明的判据优先」
   * 决定结论（顺序语义与串行版一致，不会因为谁先返回而改变判定）。 */
  const lookups = await Promise.all(
    candidates.map((c) => findPidForMainPyDetailed(c.cmd)),
  );
  for (let i = 0; i < candidates.length; i++) {
    const lookup = lookups[i]!;
    if (lookup.failed) lookupFailed = true;
    if (lookup.pid) {
      return {
        running: true,
        pid: lookup.pid,
        port: await resolvePortFast(
          lookup.pid,
          configuredPort,
          configuredPortUp,
        ),
        via: candidates[i]!.via,
        unverified: false,
        didQueryProcTable: true,
        source: snapshotSourceFor(candidates[i]!.via),
      };
    }
  }

  // 一条候选都没问过（配置路径存在但没有可解释器候选）时同样算「没查过」：
  // 上层不能把这份空快照当成「探明没在跑」。
  return {
    ...emptySnapshot(),
    unverified: lookupFailed,
    didQueryProcTable: candidates.length > 0,
  };
}

/** 候选来路 → 快照来源标记（供诊断区分「配置路径命中」与「反查命中」）。 */
function snapshotSourceFor(via: string): ComfyRuntimeSnapshot["source"] {
  if (via === "setup 中登记的启动器") return "launcher";
  if (via === "配置路径的解释器") return "process";
  // pyvenv.cfg / uv 托管解释器：都是「按环境反查」出来的解释器，即 any。
  return "any";
}

/**
 * 取一份 ComfyUI 运行态快照（带 TTL 缓存 + 在途去重）。
 *
 * 语义：`running` 表示「有 ComfyUI 进程活着」，不表示「HTTP 已经能应答」。
 * 「能不能用」仍由 `probeComfyUi()` 判定，两者在设置页合起来显示
 * 「运行中 / 启动中（进程在、接口未就绪）/ 未运行」。
 */
export async function getComfyRuntimeSnapshot(
  opts: { force?: boolean } = {},
): Promise<ComfyRuntimeSnapshot> {
  const now = Date.now();
  if (!opts.force && st.cached && !isStale(st.cached.snap, st.cached.at, now)) {
    return st.cached.snap;
  }
  if (st.inflight) return st.inflight;
  const task = snapshotOnce()
    .catch((err: unknown) => {
      logger.warn(`[comfyui] ${errorText(err, "运行态快照失败")}`);
      // 探测异常不能报成「未运行」：标 unverified 让调用方退回 HTTP 判据。
      return { ...emptySnapshot(), unverified: true };
    })
    .then((snap) => {
      st.cached = { at: Date.now(), snap };
      st.inflight = undefined;
      return snap;
    });
  st.inflight = task;
  return task;
}

/** 丢掉快照缓存：用户刚做过启动/关闭动作，下一问必须重新取事实。 */
export function resetComfyRuntimeSnapshot(): void {
  st.cached = undefined;
}
