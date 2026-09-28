/* ── lifecycle 的纯派生逻辑（无 IO、无 React）──────────────────────────
 *
 * `lifecycle.ts` 把「探测 / 拉起 / 等待就绪 / 停止」全串在副作用代码里，
 * 其中的**判断规则**散落在条件分支中，既读不出一张完整的判决表，也没法
 * 直接断言——只能起进程、看日志猜。
 *
 * 本模块把这些判断抽成纯函数：输入是「已探明的事实」，输出是「该怎么走」。
 * 调用方（lifecycle.ts）只负责取事实、执行结论，判断本身在这里可被逐条
 * 测试锁住（见 lifecycle-derive.test.ts）。
 *
 * 为什么值得单开文件：这些规则每一条都对应一次真实事故——判断写错的表现
 * 是「任务卡在队列」「窗口关了进程还在」「关掉又被悄悄拉起」，都不是
 * 读代码能一眼看出的回归。纯函数化是让它们可被 CI 拦住的最低成本手段。
 *
 * 本模块只依赖常量与类型（含 endpoints 的 URL 家函数），不 import lifecycle.ts，避免循环依赖。
 */

import { comfyUiBaseUrl } from "../endpoints";

/** 拉起方式：bound 随应用退出关闭；keepAlive 脱离进程树保活。 */
export type LaunchPolicy = "bound" | "keepAlive";

export type EnsureDecision =
  /** 已经在运行：直接用探测到的 base。 */
  | { kind: "already-up"; base: string }
  /** 用户刚手动关闭过，自动启动路径必须让路。 */
  | { kind: "skip-manual-stop" }
  /** 未开启自动启动。 */
  | { kind: "skip-autostart-off" }
  /** 未配置 ComfyUI 路径。 */
  | { kind: "skip-no-path" }
  /** 可以拉起。 */
  | { kind: "launch" };

export interface EnsureFacts {
  /** 探测到的可达 base（不可达为 null）。 */
  upBase: string | null;
  /** 调用方是否显式声明「这是用户手动启动」。 */
  manual: boolean;
  /** 用户手动关闭后残留的「不自动启动」闩锁。 */
  manualStop: boolean;
  /** 设置里是否开启自动启动。 */
  autoStart: boolean;
  /** 设置里的 ComfyUI 路径（空串视为未配置）。 */
  comfyuiPath: string;
}

/**
 * 自动启动路径的判决表。
 *
 * 顺序即优先级，每一步都在 `lifecycle.ts` 的历史修复中出现过：
 *   1. 已在运行 → 直接复用（探测可能带端口偏移，用真实 base）；
 *   2. 手动启动要**先清闩锁**（否则上次手动关闭的小尾巴会拦住这次明确启动）；
 *   3. 自动来源 + 闩锁 → 让路（ISSUE #290：切页签不该把 ComfyUI 悄悄拉起）；
 *   4. 未开自动启动 / 未配路径 → 给可行动的提示（不是无声返回）。
 */
export function decideEnsureLaunch(facts: EnsureFacts): EnsureDecision {
  if (facts.upBase) return { kind: "already-up", base: facts.upBase };
  if (!facts.manual && facts.manualStop) return { kind: "skip-manual-stop" };
  if (!facts.autoStart) return { kind: "skip-autostart-off" };
  if (!facts.comfyuiPath) return { kind: "skip-no-path" };
  return { kind: "launch" };
}

/**
 * 退出策略 → 拉起方式。
 *
 * `exitKillComfyui` 为 false（或未配置，即设置里的默认值）时视为「保活」；
 * 显式 true 才是 bound。
 * 注意开关只在**拉起那一刻**生效：桌面壳退出是整树强制关闭，
 * 退出时没有机会再改决定。
 */
export function resolveLaunchPolicy(
  exitKillComfyui: boolean | undefined,
): LaunchPolicy {
  return exitKillComfyui === true ? "bound" : "keepAlive";
}

/** spawn 参数计算所需的已探明事实。 */
export interface SpawnArgsFacts {
  /** 解析出的基础参数（解释器 + main.py + 用户额外参数之外的部分）。 */
  baseArgs: string[];
  /** 有效端口；0 / undefined 表示未指定（用默认端口）。 */
  effectivePort: number | undefined;
  /** 默认端口常量（由调用方从 app-settings 注入，避免本模块依赖配置层）。 */
  defaultPort: number;
  /** 桌面实例带来的附加参数。 */
  extraArgs: string[];
}

/**
 * 组装实际 spawn 的参数。
 *
 * 规则：只有**有效端口与默认端口不同**时才显式传 `--port`——否则会给
 * ComfyUI 传一个等于默认值的参数，白白污染日志与「界面显示端口 = 实际
 * 监听端口」的对照关系。
 */
export function buildSpawnArgs(facts: SpawnArgsFacts): string[] {
  const port =
    facts.effectivePort && facts.effectivePort > 0
      ? facts.effectivePort
      : facts.defaultPort;
  const args = [
    ...facts.baseArgs,
    ...(port !== facts.defaultPort ? ["--port", String(port)] : []),
    ...facts.extraArgs,
  ];
  /* 无条件补上内嵌放行开关（幂等）：应用把 ComfyUI 内嵌进同一窗口的页签，
   * 而两者不同源——未开 CORS 时 ComfyUI 的 origin-only 中间件会对跨源
   * 请求直接 403，页签里就是一片空白（见本文件 embed clearance 一节）。
   * 放在最后一位：不干扰 --port 与用户额外参数的位置语义。 */
  return withEmbedClearanceFlag(args);
}

/** 保活模式下「进程存在性检查」的节流判决所需事实。 */
export interface ProcessCheckFacts {
  /** 距 spawn 的毫秒数。 */
  sinceSpawnMs: number;
  /** 距上一次进程表查询的毫秒数。 */
  sinceLastCheckMs: number;
  /** 宽限期（解释器冷启动也要时间）。 */
  graceMs: number;
  /** 两次查询之间的最小间隔。 */
  intervalMs: number;
}

/**
 * 保活模式该不该在这一轮去查进程表。
 *
 * 两个条件缺一不可：①过了宽限期（冷启动期间进程可能还没出现在进程表里，
 * 早查会误判「没起来」）；②距上次查询够久（限频，避免每轮轮询都全表扫描）。
 */
export function shouldCheckKeepAliveProcess(facts: ProcessCheckFacts): boolean {
  return (
    facts.sinceSpawnMs > facts.graceMs &&
    facts.sinceLastCheckMs > facts.intervalMs
  );
}

/**
 * 保活模式的死亡判决：**连续 2 次**都查不到才算死。
 *
 * 单次查询在冷启动高负载下可能超时返回 null（进程其实活着），历史上因此
 * 误报过「保活进程已退出」。返回 true 表示本次应当判死。
 */
export function isKeepAliveDead(missCount: number): boolean {
  return missCount >= 2;
}

/** 进程秒退时从输出里提取缺失依赖的可行动报错。 */
export function extractMissingModule(outputLines: string[]): string | null {
  const m = /No module named '([^']+)'/.exec(outputLines.join("\n"));
  return m?.[1] ?? null;
}

/**
 * 进程秒退的提示文案。
 *
 * 两种成因的用户动作完全不同（装依赖 vs 看日志），所以必须分开说——
 * 只报「启动后立即退出」会让用户不知道该动哪个环境。
 */
export function buildEarlyExitDetail(outputLines: string[]): string {
  const missing = extractMissingModule(outputLines);
  if (missing) {
    return `ComfyUI 进程启动后立即退出：解释器缺少依赖（No module named '${missing}'）——请确认 comfyuiPath 指向装了依赖的环境，或为该环境安装依赖（详见 log/services/comfyui-runtime.log）`;
  }
  return "ComfyUI 进程启动后立即退出，详见 log/services/comfyui-runtime.log";
}

/** 停止流程的收尾判决所需事实（`stopComfyUiProcess`）。 */
export interface StopFacts {
  /** 是否握有本进程拉起的子进程句柄。 */
  hasChild: boolean;
  /** 依据句柄或进程表定位到的 PID。 */
  pid: number | null;
  /** 目标是否仍在响应探测。 */
  stillUp: boolean;
}

export type StopDecision =
  /** 杀进程树（平台机制由 `~/lib/process/kill-process-tree` 选）。 */
  | {
      kind: "kill";
      pid: number;
      kindLabel: "bound 子进程" | "按配置路径定位到的进程";
    }
  /** 在跑但不是本应用按配置路径启动的：只能用户自己关。 */
  | { kind: "foreign-running" }
  /** 本来就没在跑。 */
  | { kind: "not-running" };

/**
 * 关闭流程的判决。
 *
 * 关键点：只要 ComfyUI 还在运行、且能定位到 PID，就**必须**杀树——
 * 「不是我拉起的」不构成放行理由（ISSUE #100：保活实例 / 上一会话遗留的
 * 孤儿也必须关得掉）。只有「在跑但按配置路径定位不到 PID」才交给用户。
 */
export function decideStop(facts: StopFacts): StopDecision {
  if (facts.pid) {
    return {
      kind: "kill",
      pid: facts.pid,
      kindLabel: facts.hasChild ? "bound 子进程" : "按配置路径定位到的进程",
    };
  }
  return facts.stillUp ? { kind: "foreign-running" } : { kind: "not-running" };
}

/**
 * 「关闭中」进行态是否需要立刻清掉。
 *
 * 目标已经不在了、也没有正在进行的启动 → 没有理由继续显示「关闭中…」，
 * 窗口期应立刻结束（其余情况交给 `COMFY_STOPPING_WINDOW_MS` 兜底）。
 */
export function shouldClearStoppingOnStopMiss(facts: {
  stillUp: boolean;
  starting: boolean;
}): boolean {
  return !facts.stillUp && !facts.starting;
}

/** 通用「某个时刻起的计时窗口是否仍生效」：at 为 undefined 视为无窗口。 */
export function isWithinWindow(facts: {
  at: number | undefined;
  nowMs: number;
  windowMs: number;
}): boolean {
  if (facts.at === undefined) return false;
  return facts.nowMs - facts.at < facts.windowMs;
}

/** 「关闭中」窗口内的时间判据（`isComfyStopping` 的纯实现）。 */
export function isWithinStoppingWindow(facts: {
  stoppingAt: number | undefined;
  nowMs: number;
  windowMs: number;
}): boolean {
  if (facts.stoppingAt === undefined) return false;
  return facts.nowMs - facts.stoppingAt < facts.windowMs;
}

/**
 * 关闭流程的最终结论：等待若干个 500ms 探测窗口后的判定。
 * `probeResults` 按时间顺序给出每轮探测结果（null = 不可达）。
 */
export function decideStopOutcome(probeResults: (string | null)[]): {
  ok: boolean;
  detail: string;
} {
  const stillUp = probeResults[probeResults.length - 1] !== null;
  return stillUp
    ? {
        ok: false,
        detail: "关闭命令已发送，但 ComfyUI 仍在响应，请手动确认进程已退出",
      }
    : { ok: true, detail: "ComfyUI 已关闭" };
}

/* ── 内嵌放行参数（embed clearance）────────────────────────────────────
 * 为什么需要：应用把 ComfyUI 以 iframe 内嵌在同一个窗口的页签里，而
 * ComfyUI 与宿主**不同源**（宿主 http://127.0.0.1:3100，ComfyUI
 * http://127.0.0.1:<comfyuiPort>，端口不同即跨源）。
 *
 * ComfyUI 在**未开 CORS** 时挂的是 `create_origin_only_middleware()`：
 * 它按 `Sec-Fetch-Site: cross-site` 或「Host 域名 ≠ Origin 域名」直接
 * 返回 **403**（反 CSRF：防随机网站 POST 127.0.0.1 排队）。iframe 内嵌
 * 恰恰是跨源请求，于是页面内容 403 —— 页签打开了、地址也对，里面什么
 * 也看不见（ISSUE #310 的空白页签现场）。
 *
 * 关键事实：**ComfyUI 并不发 `X-Frame-Options: DENY`**（server.py 与
 * aiohttp 都不加这个头，见回归测试里的实测注释）。此前把成因记成
 * "对端拒嵌"、并据此退到「独立窗口」兜底，是在绕开一个**我们自己拉起
 * 进程时就能关掉**的开关：`--enable-cors-header` 会让 ComfyUI 改挂
 * `create_cors_middleware()`（不再 403，并回 `Access-Control-Allow-Origin`）。
 *
 * 本函数把「启动参数里必须带上内嵌放行开关」变成可测的判据：幂等——用户
 * 已在额外参数里手填过就不重复注入（重复的 `--enable-cors-header` 会被
 * argparse 当成第二个位置参数报错或覆盖语义）。
 */

/** 让 ComfyUI 放行跨源内嵌（iframe）所需的启动开关。 */
export const COMFY_EMBED_FLAG = "--enable-cors-header";

/** 该参数是否已存在（兼容 `--enable-cors-header` 与 `--enable-cors-header=ORIGIN`）。 */
export function hasEmbedClearanceFlag(args: string[]): boolean {
  return args.some((a) => {
    const lower = a.toLowerCase();
    return (
      lower === COMFY_EMBED_FLAG || lower.startsWith(`${COMFY_EMBED_FLAG}=`)
    );
  });
}

/**
 * 保证启动参数里带上内嵌放行开关。
 *
 * 默认放行值故意用 `*`（ComfyUI 的 `--enable-cors-header` 省略值时即 `*`）：
 * 本应用固定绑回环地址，且这里只解决「能被本窗口内嵌」，不引入对外暴露面
 * ——`--listen` 仍由用户的额外参数决定。
 *
 * @param args        已组装好的 spawn 参数（含 baseArgs / --port / 用户额外参数）
 * @returns 追加了开关的新数组；已有则不重复注入（原数组原样返回新副本）
 */
export function withEmbedClearanceFlag(args: string[]): string[] {
  if (hasEmbedClearanceFlag(args)) return [...args];
  return [...args, COMFY_EMBED_FLAG];
}

/* ── 运行状态结论（设置页状态行 / 启动按钮旁）─────────────────────────
 *
 * 「进程级快照 + HTTP 探测」两份事实 → 一条可渲染的结论，原本写在
 * `lifecycle.ts` 的 `buildComfyUiStatus()` 里。抽出成纯函数是因为它有两条
 * **只有跑起来才发现**的规则（都来自 ISSUE #442 的「状态来回跳」）：
 *
 *   ① 启动窗口内不落「未运行」。拉起动作与「状态行确认到运行中」之间有一段
 *      空窗（拉起 → 端口绑定 → /system_stats 就绪），其间进程表还没看到实例、
 *      HTTP 也没通，判定会得出「未运行」——而用户眼里 ComfyUI 正在启动，
 *      状态行却在「启动中」和「未运行」间来回跳。
 *   ② 「探明没在跑」的结论有黏滞期。一次成功的进程表查询「没命中」固然是
 *      「未运行」的证据，但相邻一轮的探针抖动（查询超时、环境反查没认出
 *      uv 起的实例）会给出更弱的证据并改口，用户看到的还是跳变。
 */

/** 运行状态结论所需的**纯事实**（生命周期状态由调用方翻成布尔后传入）。 */
export interface ComfyStatusFacts {
  /** 本进程发出的拉起流程正在进行（进程内单飞锁）。 */
  starting: boolean;
  /** 用户刚点过关闭、进程树尚未确认退出。 */
  stopping: boolean;
  /** 探测到的可达 base；不可达为 null。 */
  probe: string | null;
  /** 进程级快照（见 comfyui/status.ts）。 */
  snap: {
    running: boolean;
    pid: number | null;
    port: number | null;
    via: string | null;
    /** 进程表查询本身失败：本次结论不可信。 */
    unverified: boolean;
    /** 本次是否**真的查过**进程表（0 条候选时「没命中」不构成「未运行」证据）。 */
    didQueryProcTable: boolean;
  };
  /** 是否仍在「启动流程进行中」的计时窗口内（见 COMFY_STARTING_WINDOW_MS）。 */
  startingWindow: boolean;
  /** 「探明没在跑」是否仍在黏滞期内（见 COMFY_NOT_RUNNING_HOLD_MS）。 */
  notRunningHeld: boolean;
  /** 兜底 PID（本进程握着的子进程句柄；快照里没有时用它）。 */
  fallbackPid?: number | undefined;
}

export interface ComfyStatusVerdict {
  up: boolean;
  base: string | null;
  starting: boolean;
  stopping: boolean;
  /** 探测仍在进行 / 事实不可信：UI 显示「检测中…」而不是先报「未运行」。 */
  probing: boolean;
  pid?: number | undefined;
  port?: number | null;
  via?: string | null;
}

/** 两份事实 → 一条状态结论（纯组装，无 IO、无全局状态）。 */
export function deriveComfyUiStatus(
  facts: ComfyStatusFacts,
): ComfyStatusVerdict {
  const { starting, stopping, probe, snap } = facts;
  const fallbackPid = facts.fallbackPid;

  // 1) HTTP 通了：能立刻用（base 用探测到的真实地址，可能带端口偏移）。
  if (probe) {
    return {
      up: true,
      base: probe,
      starting,
      stopping,
      probing: false,
      pid: snap.pid ?? fallbackPid,
      port: snap.port ?? null,
      via: snap.via,
    };
  }

  // 2) 进程活着且已绑定端口：/system_stats 短暂不响应也算运行中。
  const port = snap.port ?? null;
  if (snap.running && port) {
    return {
      up: true,
      base: comfyUiBaseUrl(port),
      starting,
      stopping,
      probing: false,
      pid: snap.pid ?? undefined,
      port,
      via: snap.via,
    };
  }

  // 3) 进程活着但端口还没绑定：正在启动（不是「未运行」）。
  if (snap.running) {
    return {
      up: false,
      base: null,
      starting: true,
      stopping,
      probing: false,
      pid: snap.pid ?? undefined,
      port: null,
      via: snap.via,
    };
  }

  /* 4) 什么都没探到。这里是「未运行」与「不敢下结论」的分界，也是 ISSUE #442
   *    的主战场——判据从强到弱：
   *
   *      拉起流程正在进行（单飞锁）→ 「启动中」；
   *      仍在启动计时窗口内        → 「启动中」；
   *      上一轮刚探明没在跑        → 「未运行」（黏滞，不让更弱的证据改口）；
   *      没真查过进程表 / 查过但失败 → 「检测中…」（证据不足以报故障）；
   *      其余                      → 「未运行」。
   */
  const startingNow = starting || facts.startingWindow;
  return {
    up: false,
    base: null,
    starting: startingNow,
    stopping,
    probing:
      !startingNow &&
      !facts.notRunningHeld &&
      (!snap.didQueryProcTable || snap.unverified),
    pid: fallbackPid,
    port: null,
    via: null,
  };
}

/* ── 端口冲突识别（保活重定向 stderr → 等待循环的如实归因）──────────────
 *
 * 保活拉起的真实进程是 Start-Process 的孙进程：它绑定端口失败（上一会话遗留
 * 的保活实例还占着配置端口）时当场退出，而中介照样 exit 0 —— 等待循环唯一
 * 看得见的证据就是重定向 stderr 里的那行报错。此前只抄日志不参与判决，结局
 * 是「就绪判定被占端口的旧实例冒领 + 退出横幅张冠李戴」（实测现场）。
 * 这里把「这行输出意味着什么」收成纯函数，等待循环逐行喂入。
 */

/** ComfyUI 绑定端口失败时 stderr 的那句话（认核心形态，中英文与版本差异
 *  都落在这一条正则里）。 */
const PORT_CONFLICT_PATTERN = /Port\s+\d+\s+is\s+already\s+in\s+use/i;

/** 该行输出是否意味着「端口被其他实例占用，本次拉起的进程绑定失败」。
 *  误报的代价是放弃一次本可成功的等待、转走接管路径 —— 方向安全。 */
export function isPortConflictLine(line: string): boolean {
  return PORT_CONFLICT_PATTERN.test(line);
}

/** 端口冲突中止等待时的可行动文案（caller 据此转「等待已有实例就绪」）。 */
export function portConflictExitDetail(): string {
  return (
    "本次拉起的 ComfyUI 进程已退出：配置端口已被其他实例占用" +
    "（常见于上一会话遗留的保活实例仍在运行）。转为等待该实例就绪；" +
    "详见 log/services/comfyui-runtime.log"
  );
}
