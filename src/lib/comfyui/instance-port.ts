// 实例端口解析：从「配置的安装路径」直接问 OS —— 这个实例的进程在不在、
// 监听的是哪个端口。
//
// 背景（ISSUE #449）：`resolveComfyBase()` 曾把「探测」当第一判据——先探配置
// 端口，探不通就依次探 8189..8193，全落空才写一条汇总。用户要的是反过来：
// **既然配置了实例路径，就先按路径把进程找出来、顺手拿到它监听的端口**，
// 一个进程表查询 + 一次端口查询就能同时回答「在不在跑」与「在哪个端口」，
// 不必靠「逐个端口试到有人应答」去反推。
//
// 与 `status.ts` 的分工：那个是**状态展示**的判据链（多级放宽 + TTL 缓存 +
// 在途去重，还认得「另一套启动方式拉起的任意 ComfyUI」）；本模块是**连接地址
// 解析**的最小事实查询，不缓存、不带 UI 语义，供 `resolveComfyBase()` 这类
// 「我现在该连哪个地址」的调用方复用。判据顺序与 status.ts 的判据链一致，
// 但**不做**「任意解释器进程」那一级兜底——连错实例比连不上更糟。
//
// 三级判据（命中即返回，路径来自配置，不猜）：
//   ① 配置路径的 main.py 进程（含 <实例根>/ComfyUI/main.py）；
//   ② setup 登记的启动器（comfy-cli 把「怎么起这个实例」写进 .comfy-cli）；
//   ③ 解释器候选（实例根 / standalone-env / venv / uv 托管目录反查）。
//   Comfy Desktop 的实例由 uv 起、命令行里没有 main.py，②③ 就是为它准备的。

import { resolveComfyLaunchPlan } from "./launch-path";
import { classifyComfyInstall } from "./instance-kind";
import { comfyUiBaseUrl } from "../endpoints";
import {
  findPidForMainPyDetailed,
  findPidListeningPort,
  type PidLookup,
} from "./proc-detect";
import { collectComfyPythonCandidates } from "./env-python";
import { launcherCommandCandidates, readRegisteredLauncher } from "./status";

/** 事实来源，与 status.ts 的快照口径一致（便于日志里对照两处结论）。 */
export type InstanceDiscoverySource = "process" | "launcher" | "any";

export type InstanceQuery = {
  /** 配置的实例是否确有进程在跑（命令行匹配，不靠端口探测）。 */
  running: boolean;
  /** 命中进程的 PID（未命中为 null）。 */
  pid: number | null;
  /** 该进程实际监听的端口（拿不到为 null——可能还在加载、或还没绑定）。 */
  port: number | null;
  /** 哪一条判据命中的（未命中为 null）。 */
  source: InstanceDiscoverySource | null;
  /** 命中的进程是用什么起的（中文短语，供日志/提示）。 */
  via: string | null;
  /** 进程表查询本身失败（超时 / 无权限）——没命中**不等于**没在跑。 */
  unverified: boolean;
};

/** 空结果（未配置路径 / 一条判据都问不到）。 */
function noProcess(extra: Partial<InstanceQuery> = {}): InstanceQuery {
  return {
    running: false,
    pid: null,
    port: null,
    source: null,
    via: null,
    unverified: false,
    ...extra,
  };
}

/**
 * 按配置路径查「这个实例的进程在不在、监听哪个端口」。
 *
 * `comfyuiPath` 为空时直接返回空结果（没有可查的对象）。`port` 为 null 且
 * `running` 为 true 表示「进程活着但还没绑定端口」（正在加载）——这是个
 * **有意义的中间态**：调用方应据此等待而不是换地址猜。
 */
export async function queryInstanceByPath(
  comfyuiPath: string,
): Promise<InstanceQuery> {
  const root = comfyuiPath?.trim();
  if (!root) return noProcess();

  let unverified = false;
  const plan = resolveComfyLaunchPlan(root);

  // ① 配置路径的 main.py：进程表命中即「在跑」（不要求 HTTP 已就绪）。
  if (!("error" in plan)) {
    const lookup = await findPidForMainPyDetailed(plan.mainPy);
    if (lookup.pid) {
      return withPort(lookup, "process", "配置路径的实例");
    }
    if (lookup.failed) unverified = true;
  }

  // ② 启动器形态：Comfy Desktop 由 standalone-env（uv）起，命令行里没有
  //    main.py，① 必然落空。先试 setup 登记的启动器，再试解释器候选。
  const classify = classifyComfyInstall(root);
  const registered = readRegisteredLauncher(classify.instanceRoot ?? root);
  const candidates: {
    cmd: string;
    via: string;
    source: InstanceDiscoverySource;
  }[] = [];
  if (registered) {
    candidates.push({
      cmd: registered,
      via: "setup 中登记的启动器",
      source: "launcher",
    });
  }
  if (!("error" in plan)) {
    for (const cmd of launcherCommandCandidates(plan.cmd)) {
      candidates.push({ cmd, via: "配置路径的解释器", source: "process" });
    }
  }
  // ③ 环境反查：standalone-env 的解释器常由 uv 托管（不在实例根），
  //    顺 pyvenv.cfg 的 home/executable 与 uv 目录反推（见 env-python.ts）。
  for (const c of collectComfyPythonCandidates(classify.instanceRoot ?? root)) {
    candidates.push({ cmd: c.exe, via: c.via, source: "any" });
  }

  // 候选**并发**查进程表：它们是「同一件事的几种问法」，彼此无依赖；串行
  // 会把冷启动的等待叠成 N 倍（每次查询要起一个 PowerShell 枚举，本机 ~2.5s）。
  // 命中后按候选**原始顺序**取第一个，保证「先声明的判据优先」。（与
  // status.ts 同一处优化，ISSUE #339 的残留延迟。）
  const lookups = await Promise.all(
    candidates.map((c) => findPidForMainPyDetailed(c.cmd)),
  );
  for (let i = 0; i < candidates.length; i++) {
    const lookup = lookups[i]!;
    if (lookup.failed) unverified = true;
    if (lookup.pid) {
      return withPort(lookup, candidates[i]!.source, candidates[i]!.via);
    }
  }

  // 一条候选都没命中：查过但没查失败 = 「确认不在跑」；有失败 = 结论不可信。
  return noProcess({ unverified });
}

/** 命中进程后补上监听端口（拿不到就留 null = 进程在、端口未绑定）。 */
async function withPort(
  lookup: PidLookup,
  source: InstanceDiscoverySource,
  via: string,
): Promise<InstanceQuery> {
  const pid = lookup.pid!;
  return {
    running: true,
    pid,
    port: await findPidListeningPort(pid),
    source,
    via,
    unverified: false,
  };
}

/**
 * 把一次「单端口事实」拼成 base URL。
 *
 * 只认本机回环 + 显式端口：实例的监听端口是进程级事实，天然属于 127.0.0.1。
 * 环境变量 `COMFYUI_BASE` 指向的是**另一个**地址（可能是远端主机），那种
 * 场景下端口事实没有意义——返回 null，由调用方走既有的探测链路。
 */
export function baseForLocalPort(port: number | null): string | null {
  if (port == null || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  if (process.env.COMFYUI_BASE) return null;
  return comfyUiBaseUrl(port);
}
