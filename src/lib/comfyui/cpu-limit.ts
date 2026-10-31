/* ── ComfyUI 子进程的 CPU 占用上限（纯判据，无 IO）─────────────────────
 *
 * 用户诉求（ISSUE #1959）：「需要限制 cpu 占用」。出图是**可长跑的后台负载**，
 * 它把机器占满时，用户手里的编辑器 / 浏览器 / 画布拖拽都在抢同一批核 ——
 * 桌包的核心用途是「开着它干活」，所以「出图不许把整机吃干」是一条产品级需求，
 * 而不是可选的性能优化。
 *
 * 本模块只回答**该给这个子进程上什么档**，不负责施加（施加在
 * `cpu-limit-apply.ts`：起进程后按判据调一把系统能力）。分两份的理由与
 * `lifecycle-derive` / `status` 一族同源：档位判据要能被逐条断言，
 * 而施加那一步是平台相关的副作用、只能靠真起进程验。
 *
 * ## 三档而非「一个数字」
 *
 * 操作系统层面能约束 CPU 的**可用手段不止一种**，而它们在不同平台上的
 * 代价天差地别：
 *
 *   · 调**优先级**（Windows `Start-Process -Priority` / POSIX `renice`）：
 *     零依赖、零常驻开销，代价是「只在有竞争者时才让路」—— 机器闲着时
 *     出图照样跑满，这正是桌面场景想要的（谁在等谁让路）。
 *   · 调**亲和性**（只给 N 个核）：Windows `ProcessorAffinity` / POSIX
 *     `taskset`，语义是「最多用几个核」，比优先级更硬，但会把出图本身
 *     拖慢，且和「用户后来想让它跑快点」冲突。
 *   · 硬**限速**（`cpulimit` 一类）：POSIX 上要外部程序，Windows 上无对应物，
 *     等于引入一处平台分叉 + 一个可选依赖 —— 本仓平台判据只许收在两处
 *     （AGENTS 硬规则 3），所以**刻意不做这一档**。
 *
 * 于是档位按「用户能说清楚的那三件事」定：不动 / 让路（默认给前台）/ 限核。
 *
 * ## 为什么默认是「让路」而不是「不动」
 *
 * 出图进程是本应用**自己拉起的**、长跑的、且用户此刻多半在做别的事 ——
 * 这三条合起来与「后台任务」的定义逐字吻合。默认让路是把它当后台任务对待，
 * 而用户真要抢时间时可以在设置页调回「不动」（那一档也在，不是缺席）。
 */

import { clampInt } from "~/lib/clamp";

/** 判据所需的**事实**（全部由调用方从设置与平台读，本模块不做 IO）。 */
export interface CpuLimitFacts {
  /** 设置里的档位；缺省（老设置文件里没有这个键）按 `yield` 处理。 */
  mode: CpuLimitMode | undefined;
  /** 目标平台（注入以便用例喂两种平台断言两种形状）。 */
  platform: NodeJS.Platform;
  /**
   * 当前进程是否处于**桌面壳内**（Tauri）。
   *
   * 为什么它进判据：浏览器 / dev 形态下「用户在前台用电脑」这件事没有意义
   * （壳自己就是前台），而桌面壳里用户看得见出图进度条 —— 让路档正是为
   * 那一种场景发明的。这条只影响**默认值**，用户显式选过的档一律照办。
   */
  desktopShell: boolean;
}

/** CPU 档位：不动 / 让路（后台优先）/ 限核。 */
export type CpuLimitMode = "off" | "yield" | "throttle";

/** 档位的**取值集合**（设置页、校验、默认值三处共用一份，别各写一遍）。 */
export const CPU_LIMIT_MODES: ReadonlyArray<CpuLimitMode> = ["off", "yield", "throttle"];

/** 「限核」档留给 ComfyUI 的核数上限（占本机逻辑核的比例）。 */
export const THROTTLE_CPU_RATIO = 0.5;

/** 「限核」档下至少给几个核（单核 / 双核机器上 `ratio` 会取到 0，那等于不让它跑）。 */
export const THROTTLE_MIN_CORES = 1;

/**
 * 设置里的人话档位名（设置页下拉与「当前生效」提示共用一份）。
 *
 * 收在这里而不是视图里：同一档在两处（下拉 + 状态行）出现，各写一遍人名
 * 就会漂成「让路」与「低优先级」两种说法指同一件事（§12.14）。
 */
export const CPU_LIMIT_LABELS: Record<CpuLimitMode, string> = {
  off: "不限制（出图全速）",
  yield: "出图让路（前台优先）",
  throttle: `限核（最多 ${THROTTLE_CPU_RATIO * 100}% 的核）`,
};

/** 档位的取值校验（设置项从 JSON 读进来时是 `unknown`）。 */
export function toCpuLimitMode(value: unknown): CpuLimitMode {
  /* SAFETY: 类型断言已复核 */
  return CPU_LIMIT_MODES.includes(/* SAFETY: 类型断言已复核 */ value as CpuLimitMode)
    ? (value as CpuLimitMode)
    : "yield";
}

/**
 * 生效档位：设置没写过这个键时按**桌面壳 / 浏览器**分叉的默认值。
 *
 * 老设置文件（`app-settings.json` 里没有 `comfyuiCpuLimit`）走的就是这一支 ——
 * 这也是本条唯一「按环境猜」的地方，且有下界：浏览器形态下默认 `off`，
 * 因为那里没有「用户在同一个窗口里干别的活」这回事，凭空降速只会让人困惑。
 */
export function resolveCpuLimitMode(facts: CpuLimitFacts): CpuLimitMode {
  if (facts.mode !== undefined) {
    return facts.mode;
  }
  return facts.desktopShell ? "yield" : "off";
}

/**
 * 该档位要求施加的**命令形态**（`off` 返回 null = 什么都不做）。
 *
 * 返回的是「要调用的可执行文件 + 参数」，而不是「去调哪个 API」：两条链路
 * （Windows 的 WMI/PowerShell、POSIX 的 renice/taskset）都是**命令行能力**，
 * 而注入命令行是唯一能让用例在不起真进程的前提下断言形状的做法
 * （与 `kill-process-tree` 的 `taskkillPath` 注入同款）。
 *
 * 三处平台事实集中在这里，不做「按平台 if 两遍」的散写：
 *   · Windows：`powershell.exe -NoProfile -Command` 走 WMI 的
 *     `Win32_Process` 优先级属性。**不用 `Start-Process -Priority`** ——
 *     那要求由 PowerShell 自己起进程，而保活路径的子进程是 `spawnManaged`
 *     起的（Start-Process 的孙进程），拿不到它的句柄再改优先级；按 PID 改
 *     是唯一对两条路径都成立的形态（bound 与 keepAlive 都拿得到 PID）。
 *   · POSIX：`renice` 调优先级、`taskset` 调亲和性。两者都是 util-linux /
 *     BSD 基座的常备件，但**仍可能缺失** —— 缺失时按「本档不生效」处理并
 *     留一行日志，绝不让它把启动搞挂（见 `apply`）。
 */
export interface CpuLimitCommand {
  /** 可执行文件。 */
  command: string;
  /** 参数数组。 */
  args: Array<string>;
  /** 这一档实际做了什么（写进运行日志的一句话）。 */
  describe: string;
}

/** 本机逻辑核数（`os.cpus().length`，取不到时按 2 兜底 —— 见 `throttleCores`）。 */
export function throttleCores(
  cpuCount: number,
  ratio: number = THROTTLE_CPU_RATIO,
  min: number = THROTTLE_MIN_CORES,
): number {
  /* 取不到核数（`os.cpus()` 在个别沙箱里返回空数组）时按 2 算：给 1 个核，
   * 这是「限核」档的下界语义（总得让它跑）。夹取走 `~/lib/clamp` 的唯一出口
   * （P59 硬闸：视图 / 逻辑 / 服务端里不许手写 `Math.max(…, Math.min(…))`）。 */
  const total = Number.isFinite(cpuCount) && cpuCount > 0 ? cpuCount : 2;
  return clampInt(Math.floor(total * ratio), min, total);
}

/** Windows 的优先级类名（`Win32_Process.Priority` 的取值）。 */
export const WINDOWS_BELOW_NORMAL = "BelowNormal";

/** POSIX 的 nice 增量（正值 = 降低优先级）。 */
export const POSIX_NICE_INCREMENT = 10;

/**
 * 把档位翻成 `[优先级命令, 亲和性命令]`（缺哪一半给 null）。
 *
 * 为什么返回**两条**而不是一条：优先级与亲和性是两种不同的约束，且
 * 「限核」档要**同时**上（既限核又让路才是它名字的意思）。让调用方看到
 * 两格，也就不会有人以为它们互斥。
 */
export function cpuLimitCommands(input: {
  mode: CpuLimitMode;
  platform: NodeJS.Platform;
  pid: number;
  /** 本机逻辑核数（只有 `throttle` 档用得上）。 */
  cpuCount: number;
}): { priority: CpuLimitCommand | null; affinity: CpuLimitCommand | null } {
  const { mode, platform, pid } = input;
  if (mode === "off") {
    return { priority: null, affinity: null };
  }

  const win = platform === "win32";
  /* 优先级那一半：两档都要。Windows 走 WMI SetPriority（`Set-CimInstance`
   * 的 Win32_Process 子集支持 `Priority` 属性），POSIX 走 `renice`。
   *
   * Windows 的写法刻意用**单引号 + 拼路径**而不是 `-Filter`：这条判据
   * 与 `proc-detect` 的 WMI 查询同源（那里记了「双引号在 execFile → PS
   * -Command 链路上会变形」的现场），照抄同一形态免得后人以为可以简化。 */
  const priority: CpuLimitCommand = win
    ? {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue | ` +
            `ForEach-Object { $_.Priority = ${WINDOWS_BELOW_NORMAL}; $_.Put() | Out-Null }`,
        ],
        describe: `Windows 进程优先级调到 ${WINDOWS_BELOW_NORMAL}（让路给前台）`,
      }
    : {
        command: "renice",
        args: ["-n", String(POSIX_NICE_INCREMENT), "-p", String(pid)],
        describe: `nice +${POSIX_NICE_INCREMENT}（让路给前台）`,
      };

  if (mode === "yield") {
    return { priority, affinity: null };
  }

  /* 限核档：亲和性那一半。Windows 用 WMI 的 `ProcessorAffinity`，
   * POSIX 用 `taskset -c 0-<n-1>`。 */
  const cores = throttleCores(input.cpuCount);
  const affinity: CpuLimitCommand = win
    ? {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue | ` +
            `ForEach-Object { $_.ProcessorAffinity = ${(1n << BigInt(cores)) - 1n}; $_.Put() | Out-Null }`,
        ],
        describe: `Windows 处理器亲和性限到 ${cores} 个核`,
      }
    : {
        command: "taskset",
        args: ["-cp", `0-${cores - 1}`, String(pid)],
        describe: `taskset 限到 ${cores} 个核`,
      };

  return { priority, affinity };
}
