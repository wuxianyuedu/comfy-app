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

import fs from "fs";
import path from "path";
import { getSettingsSync } from "../app-settings";
import { resolveComfyLaunchPlan } from "./launch-path";
import { classifyComfyInstall } from "./instance-kind";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { collectComfyPythonCandidates } from "./env-python";
import { logger } from "~/server/lib/logger";

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
  /** 事实来源：bound=本进程持有的子进程；process=配置路径进程表命中；
   *  launcher=setup 登记启动器；any=按环境反查（pyvenv.cfg / uv 托管解释器）
   *  出来的解释器进程。 */
  source: "bound" | "process" | "launcher" | "any" | null;
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

const G_KEY = "__comfyRuntimeSnapshot_v1";
const g = globalThis as unknown as Record<string, SnapshotGlobal | undefined>;
const st: SnapshotGlobal = g[G_KEY] ?? {};
g[G_KEY] = st;

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
  return { running: false, pid: null, port: null, via: null, unverified: false, source: null };
}

/** 本进程持有的子进程（bound 模式）：最可靠的事实，优先于任何查询。
 *
 * 读的是 lifecycle 挂在 globalThis 上的会话状态（HMR 单例）。测试可用
 * `setBoundChildPidReader` 注入桩，避免为一条判据去搭真实子进程。
 */
type ChildHolder = { child?: { pid?: number } };

let readBoundChildPid: () => number | null = () => {
  const holder = (globalThis as unknown as { __comfyLifecycle_v1?: ChildHolder })
    .__comfyLifecycle_v1;
  const pid = holder?.child?.pid;
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
  const exts = process.platform === "win32" ? ["pythonw.exe", "python.exe"] : ["pythonw", "python"];
  // 去重：便携版解释器本身就叫 python.exe，枚举结果与候选重复时不必查两遍。
  return [...new Set([...exts.map((n) => path.join(dir, n)), pythonExe])];
}

/** 读 setup 登记的启动器（ComfyUI 的 `comfy-cli` 会把「怎么起这个实例」写到
 *  `.venv/Lib/site-packages/comfy_cli/.comfy-cli` 的 setup 节）。只在
 *  comfyuiPath 存在且是目录时读一次，读不到返回 null（纯尽力而为）。 */
export function readRegisteredLauncher(comfyuiPath: string): string | null {
  if (!comfyuiPath) return null;
  const registry = path.join(
    /*turbopackIgnore: true*/ comfyuiPath,
    ".venv",
    "Lib",
    "site-packages",
    "comfy_cli",
    ".comfy-cli",
  );
  let raw: string;
  try {
    raw = fs.readFileSync(/*turbopackIgnore: true*/ registry, "utf8");
  } catch {
    // 兜底：comfyuiPath 本身就是注册表文件（少见，但比「静默不认」好）。
    try {
      raw = fs.readFileSync(/*turbopackIgnore: true*/ comfyuiPath, "utf8");
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

async function snapshotOnce(): Promise<ComfyRuntimeSnapshot> {
  const settings = getSettingsSync();

  // 1) bound 子进程：本进程亲手拉起的，PID 直接可信（无需查进程表）。
  const bound = boundChildPid();
  if (bound) {
    const port = await findPidListeningPort(bound);
    return { running: true, pid: bound, port, via: "本应用启动的进程", unverified: false, source: "bound" };
  }

  const comfyuiPath = settings.comfyuiPath?.trim() ?? "";
  if (!comfyuiPath) return emptySnapshot();

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
        port: await findPidListeningPort(lookup.pid),
        via: "配置路径的实例",
        unverified: false,
        source: "process",
      };
    }
    if (lookup.failed) lookupFailed = true;
  }

  // 3) 启动器形态：Comfy Desktop 的 standalone-env 由 uv 启动，命令行里没有
  //    main.py（步骤 2 必然落空）；先试 setup 登记的启动器，再试解释器候选。
  const classify = classifyComfyInstall(comfyuiPath);
  const registered = readRegisteredLauncher(classify.instanceRoot ?? comfyuiPath);
  const candidates: { cmd: string; via: string }[] = [];
  if (registered) candidates.push({ cmd: registered, via: "setup 中登记的启动器" });
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

  for (const c of candidates) {
    const lookup = await findPidForMainPyDetailed(c.cmd);
    if (lookup.failed) lookupFailed = true;
    if (lookup.pid) {
      return {
        running: true,
        pid: lookup.pid,
        port: await findPidListeningPort(lookup.pid),
        via: c.via,
        unverified: false,
        source: snapshotSourceFor(c.via),
      };
    }
  }

  return { ...emptySnapshot(), unverified: lookupFailed };
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
      logger.warn(
        `[comfyui] 运行态快照失败：${err instanceof Error ? err.message : String(err)}`,
      );
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
