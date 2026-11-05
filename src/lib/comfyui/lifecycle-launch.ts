/* ── ComfyUI 启动编排（ISSUE #570 第 1~3 项）──────────────────────────
 *
 * 「拉起 + 等待就绪」的**机制**层：`ensureComfyUiReady` 含一个长 IIFE 与三个
 * 不可测回调，全塞在一处会既读不动也测不了。这里保留机制，`lifecycle.ts`
 * 只留「取事实 → 判决 → 交付」。
 *
 * 两条路径（keepAlive / bound）共用 `waitForComfyReady` 的策略注入等待循环：
 * 差别只在探测方式与判死方式，循环体与超时文案只有一份。
 *
 * 与宿主的耦合（`st` 单例、运行日志、横幅、清除「关闭中」标记）经
 * {@link LaunchHost} 注入，而不是回引 `lifecycle.ts` —— 后者会成环（§12.7）。
 */

import { errorText } from "~/lib/error-message";
// §18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批·汇聚点）。
// 静态依赖里除 `../app-settings/app-settings.server`（`.server` 后缀、内部无
// server-only、纯 Node 可加载）以外，其余全在 comfyui 前 8 批与 lib 层地基批
// 中纯化——`~/lib/process/process-launch`（本批同批摘除）、`~/lib/core/logger`
// （经 #1075 app-runtime-log + #1074 log-paths 通链）、`./launch-path` /
// `./proc-detect` / `./desktop-instance` / `./lifecycle-exit`（叶模块批 #1056 /
// #1077）、`~/lib/log/log-paths`（#1074）。登记进 `PURE_NODE_HOSTS`。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getExitPolicy } from "../app-settings/app-settings.server";
import { COMFYUI_DEFAULT_PORT, comfyUiBaseUrl } from "../endpoints";
import { INLINE_STDERR_MAX, clampText } from "../text-clamp";
import type { getSettingsSync } from "../app-settings/app-settings.server";
import { resolveComfyLaunchPlan } from "./launch-path";
import { resolveEffectiveLaunch } from "./desktop-instance";
import { findPidForMainPyDetailed, findPidListeningPort } from "./proc-detect";
import { spawnManaged, waitForDetachMediator } from "~/lib/process/process-launch";
import { SERVICES_LOG_DIR } from "~/lib/log/log-paths";
import {
  buildEarlyExitDetail,
  buildSpawnArgs,
  diagnoseComfyStartupFailure,
  isKeepAliveDead,
  isPortConflictLine,
  portConflictExitDetail,
  resolveLaunchPolicy,
  shouldCheckKeepAliveProcess,
} from "./lifecycle-derive";
import {
  createChildExitHandler,
  createOutputSink,
  createRecentOutputLedger,
  waitForComfyReady,
} from "./lifecycle-wait";
import { reportKeepAliveExit, startComfyExitWatcher, type ComfyExitReport } from "./lifecycle-exit";
import { getComfyRuntimeSnapshot } from "./status";
import { applyComfyCpuLimit } from "./cpu-limit-apply";
import { CPU_LIMIT_LABELS, resolveCpuLimitMode, type CpuLimitMode } from "./cpu-limit";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { decodeIncremental } from "~/lib/log/utf8-incremental";
import { fireAndForget } from "~/lib/async-action";

export type EnsureResult = {
  base: string | null;
  detail: string;
  ok: boolean;
  /** 保活拉起的进程因端口被占而绑定失败（caller 据此转「等待已有实例就绪」）。 */
  portConflict?: boolean;
};

/** 保活启动的进程存在性检查：宽限期（解释器冷启动也要时间）后才首次检查，
 *  之后限频复查 —— 防止把「正在启动」误判为「没起来」，也避免每轮轮询
 *  都扫一次进程表。 */
const COMFY_KEEPALIVE_GRACE_MS = 15_000;
const COMFY_KEEPALIVE_PROCESS_CHECK_INTERVAL_MS = 5000;

/** 宿主提供的能力（`lifecycle.ts` 注入；本模块不反向 import 它）。 */
export type LaunchHost = {
  /** 写本次启动的 runtime 日志一行。 */
  appendRuntimeLog: (line: string) => void;
  /**
   * 开一次启动的日志文件（`comfyui-runtime-<时刻>.log`），返回它的路径。
   *
   * 由拉起**之前**那一步调用 —— 一次启动一份文件之后，「本次启动的日志在哪」
   * 是文件本身回答的（不在是同一份文件里靠横幅分段）。同秒内重复启动由写入器
   * 分叉出 `-2` / `-3`，不会覆盖前一次的现场。
   */
  beginRuntimeSession: () => string;
  /** 清掉「关闭中」标记（进程已确认退出 / 用户重新点了启动）。 */
  clearComfyStopping: () => void;
  /** 本地时间戳（保活重定向文件名用）。 */
  localTimestamp: () => string;
  /** 记下「本次会话结束了」。应用自己也一起没了时这一步不会发生 ——
   *  那正是下次启动要反推的情况。 */
  markSessionEnd: (report: ComfyExitReport) => void;
  /** 记下「本次会话开始了」（写 `log/services/comfyui-last-session.json`）。 */
  markSessionStart: (info: { mode: "keepAlive" | "bound"; pid: number | null }) => void;
  /** 探测 ComfyUI 是否可达（注入以避免 `本模块 → lifecycle.ts` 的循环依赖）。 */
  probeComfyUi: (timeoutMs?: number) => Promise<string | null>;
  /** 启动单飞锁与子进程句柄（HMR 单例）。 */
  st: {
    child?: ReturnType<typeof spawn>;
    childDetached?: boolean;
    stopRequested?: boolean;
  };
};

/** 启动编排的上下文：把「怎么记日志」「探到多少事实」显式传下去，让两条
 *  启动路径（keepAlive / bound）与等待循环都不再闭包捕获 `ensureComfyUiReady`
 *  的局部状态 —— 这正是 ISSUE #570 第 1~3 项要拆掉的那 288 行 IIFE。 */
type EnsureCtx = {
  /** 最终启动参数（已含 --port / --enable-cors-header / 额外参数）。 */
  args: Array<string>;
  /** 生效的 CPU 档位（ISSUE #1959）。在拉起前解析一次、两条路径共用 ——
   *  「哪一档」是用户设置，与「怎么起」无关，不该在两条路径里各判一遍。 */
  cpuLimitMode: CpuLimitMode;
  /** 硬超时绝对时间戳；null = 不设硬超时。 */
  deadline: number | null;
  /** 记一条日志（logger + onLog + 运行日志文件）。 */
  note: (msg: string) => void;
  /** 解析出的启动计划（cmd / args / cwd / mainPy）。 */
  plan: { cmd: string; cwd: string; mainPy: string };
  /** 子进程环境（含 PYTHONIOENCODING / PYTHONUTF8 / 桌面实例 envVars）。 */
  stdioEnv: NodeJS.ProcessEnv;
  /** 超时未就绪文案（**唯一一处**，两条路径共用）。 */
  timeoutDetail: string;
};

/**
 * 给刚拉起的 ComfyUI 施加 CPU 档位，并把结论写进运行日志。
 *
 * **fire-and-forget 是有意的**：调优先级 / 亲和性要等系统命令回来，而启动
 * 路径此刻正在等端口就绪 —— 一个可选的性能开关不该有把启动拖慢的权力。
 * 失败也不抛出，只留一行可读的原因（硬规则 4：失败路径必须有用户可见出口）。
 *
 * `pid` 为 null（keepAlive 的孙进程此刻还查不到）时什么都不做：
 * 那条路径由退出监督器随后按 main.py 反查到 PID，本函数在 `onLaunched`
 * 时机被再调一次（见 `launchKeepAliveMode` 的 `isDead` 分支之外那条）。
 */
function applyCpuLimitAsync(input: {
  mode: CpuLimitMode;
  note: (msg: string) => void;
  pid: number | null;
}): void {
  if (input.mode === "off") {
    return;
  }
  fireAndForget(
    applyComfyCpuLimit({ pid: input.pid, mode: input.mode }).then((outcome) => {
      for (const r of outcome.results) {
        input.note(
          r.ok
            ? `CPU 档位已生效：${r.describe}`
            : `CPU 档位未生效（${r.describe}）：${r.detail}——出图仍按默认优先级运行`,
        );
      }
    }),
    (err) => {
      /* 施加层的 `runCommand` 已经把命令失败收进 results，落到这里的是
       * 意料外的异常（拼命令时的 bug）。静默会让「设置页说限了、实际没限」
       * 变成查不出来的形态，所以如实记一条。 */
      input.note(
        `CPU 档位施加抛出异常（不影响启动）：${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );
}

/** 保活路径的 PID 反查重试：初查 + 最多几次复查（间隔见下）。 */
const KEEPALIVE_CPU_PID_ATTEMPTS = 6;
const KEEPALIVE_CPU_PID_INTERVAL_MS = 2000;

/**
 * 保活路径专属：按 `main.py` 反查到 ComfyUI 进程 PID，再施加 CPU 档位。
 *
 * 为什么要有界重试而不是查一次：解释器冷启动（`import torch` + 读权重）在慢盘上
 * 要好几秒，第一次查必然落空 —— 查一次就放弃等于这一档在保活路径上**恒不生效**。
 * 又为什么不是「一直重试到查到为止」：那会在「用户配的解释器根本起不来」的场景里
 * 变成一个永不收手的后台循环。故取 6 次 × 2s（12s 窗口，覆盖冷启动），
 * 用尽后如实记一条，让用户知道这一档没生效、而不是以为它生效了。
 */
async function resolveAndApplyCpuLimitForKeepAlive(input: {
  mainPy: string;
  mode: CpuLimitMode;
  note: (msg: string) => void;
}): Promise<void> {
  if (input.mode === "off") {
    return;
  }
  for (let attempt = 0; attempt < KEEPALIVE_CPU_PID_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await new Promise((r) => setTimeout(r, KEEPALIVE_CPU_PID_INTERVAL_MS));
    }
    let pid: number | null;
    try {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      pid = (await findPidForMainPyDetailed(input.mainPy)).pid;
    } catch {
      /* 查询本身抛错（极罕见）：当作这一轮没查到，下一轮再试。 */
      continue;
    }
    if (pid === null) {
      continue;
    }
    applyCpuLimitAsync({ pid, mode: input.mode, note: input.note });
    return;
  }
  input.note(
    `CPU 档位未能施加：启动后 ${(KEEPALIVE_CPU_PID_ATTEMPTS * KEEPALIVE_CPU_PID_INTERVAL_MS) / 1000}s 内没查到 ComfyUI 进程（出图仍按默认优先级运行）`,
  );
}

/**
 * 拉起后的编排入口：按退出策略选 keepAlive 或 bound，两者共用同一套等待原语。
 * 拆出来是为了让 `ensureComfyUiReady` 只留「取事实 → 判决 → 交付」，
 * 启动机制本身（含 288 行 IIFE）不再挤在同一个函数里。
 */
export async function runEnsureLaunch(input: {
  host: LaunchHost;
  note: (msg: string) => void;
  settings: ReturnType<typeof getSettingsSync>;
  timeoutMs?: number | null;
}): Promise<EnsureResult> {
  const { note, settings, host } = input;
  const plan = resolveComfyLaunchPlan(settings.comfyuiPath);
  if ("error" in plan) {
    note(plan.error);
    return { ok: false, base: null, detail: plan.error };
  }
  if (plan.hasDeps === false) {
    note(
      `提示：所选解释器（${plan.cmd}）的 site-packages 里没有 torch，启动大概率会失败——请检查 ComfyUI 环境`,
    );
  }

  // 有效端口/额外参数：桌面实例读 Comfy Desktop 元数据（launchArgs→headless
  // 映射），便携/venv 走设置里的 comfyuiPort / comfyuiExtraArgs。非默认端口
  // 显式传 --port，保证「界面显示端口 = 实际监听端口」一致。
  const eff = await resolveEffectiveLaunch({
    comfyuiPath: settings.comfyuiPath,
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- settings 由 app-settings.json 经 JSON.parse 合并而来，历史文件里 comfyuiPort 可能为 null
    comfyuiPort: settings.comfyuiPort ?? 0,
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- settings 由 app-settings.json 经 JSON.parse 合并而来，历史文件里 comfyuiExtraArgs 可能为 null
    comfyuiExtraArgs: settings.comfyuiExtraArgs ?? "",
  });
  const args = buildSpawnArgs({
    baseArgs: plan.baseArgs,
    effectivePort: eff.port,
    defaultPort: COMFYUI_DEFAULT_PORT,
    extraArgs: eff.extraArgs,
  });

  // 退出策略决定拉起方式：exitKillComfyui=true → bound，ComfyUI 挂在应用
  // 进程树内，应用退出连带关闭；false（默认，见 app-settings 的 DEFAULTS）
  // → keepAlive，脱离进程树保活，下次打开应用直接复用。注意开关只在
  // 「拉起时」生效（桌面壳退出是整树强制关闭，退出那一刻没有
  // 机会再决定）。
  const keepAlive = resolveLaunchPolicy(getExitPolicy().exitKillComfyui) === "keepAlive";
  /* 先换一份新的日志文件再写下第一条 —— 顺序反了会把本次的头几行写进上一次
   * 的文件里，而那正是「日志看起来少了一次」的现场（没有报错、只是归属错了）。 */
  host.beginRuntimeSession();
  note(
    `ComfyUI 未运行，按配置路径启动：${plan.cmd} ${args.join(" ")}${keepAlive ? "（保活模式：应用退出后不关闭）" : ""}`,
  );

  const ctx: EnsureCtx = {
    note,
    plan,
    args,
    stdioEnv: {
      ...process.env,
      ...eff.envVars,
      PYTHONIOENCODING: "utf8",
      PYTHONUTF8: "1",
    },
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    deadline: input.timeoutMs == null ? null : Date.now() + input.timeoutMs,
    timeoutDetail: `ComfyUI 启动超过 ${Math.round((input.timeoutMs ?? 0) / 1000)}s 仍未就绪，继续留在后台观察；详见 log/services/comfyui-runtime.log`,
    cpuLimitMode: resolveCpuLimitMode({
      mode: settings.comfyuiCpuLimit,
      platform: process.platform,
      desktopShell: isDesktopShell(),
    }),
  };
  /* 档位说清楚（含「当前不限制」这一档）：用户改了设置之后，唯一能确认
   * 「它真的按我选的来了」的地方就是这一行。 */
  if (ctx.cpuLimitMode !== "off") {
    note(`CPU 档位：${CPU_LIMIT_LABELS[ctx.cpuLimitMode]}（启动后施加）`);
  }
  const result = keepAlive
    ? await launchKeepAliveMode(host, ctx)
    : await launchBoundMode(host, ctx);
  if (!result.ok && result.portConflict === true) {
    /* 端口被占：占着端口的极可能就是另一个 ComfyUI 实例（上一会话的保活移交 /
     * 外部启动）。与其把「启动失败」甩给排队任务，不如转去等那个实例就绪 ——
     * 就绪判定与接管复用同一条路径。只转一次：再失败就如实回报。 */
    note("配置端口已被其他实例占用，转为等待该实例就绪…");
    return waitForExistingInstanceReady({
      host,
      settings,
      timeoutMs: input.timeoutMs ?? null,
      note,
    });
  }
  return result;
}

/**
 * 等待「已在运行的实例」就绪并接管（**不 spawn 新进程**）。
 *
 * 两个入口：
 *   · `ensureComfyUiReady` 的入口分支 —— HTTP 探测没探到（实例正忙 / 冷加载中，
 *     `/system_stats` 超 1.5s）但进程级快照确认进程在跑。此时再 spawn 一个新
 *     进程，结局是「端口被占秒退 + 就绪判定被旧实例的应答冒领 + 退出横幅张冠
 *     李戴」（实测现场）；改为等这个实例自己就绪。
 *   · `runEnsureLaunch` 的端口冲突兜底 —— 拉起后才发现端口被占，转同一条路。
 *
 * 判死用进程级快照而不是 mainPy 进程表直查：快照的候选链覆盖 Comfy Desktop
 * （uv 起、命令行没有 main.py）那一族，且「查询失败（unverified）」与「查过
 * 没命中」分得开 —— 前者不下结论，连续 2 次确认查无进程才判死（与保活退出
 * 监督器同一口径）。
 */
export async function waitForExistingInstanceReady(input: {
  host: LaunchHost;
  note: (msg: string) => void;
  settings: ReturnType<typeof getSettingsSync>;
  /** 硬超时时长（毫秒）；null = 不设硬超时（手动启动语义，与拉起路径一致）。 */
  timeoutMs: number | null;
}): Promise<EnsureResult> {
  const { host, settings, note } = input;
  let goneStreak = 0;
  const result = await waitForComfyReady({
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    deadline: input.timeoutMs == null ? null : Date.now() + input.timeoutMs,
    timeoutDetail: `已有 ComfyUI 实例持续未响应（等待 ${Math.round((input.timeoutMs ?? 0) / 1000)}s 后放弃）；可能正忙或已卡死，详见 log/services/comfyui-runtime.log`,
    readyDetail: "ComfyUI 已就绪（接管已在运行的实例）",
    onReady: (base) => {
      note(`ComfyUI 已就绪（接管）：${base}`);
    },
    onDead: (detail) => {
      note(detail);
    },
    earlyExit: () =>
      host.st.stopRequested === true
        ? {
            ok: false,
            base: null,
            detail: "已手动关闭 ComfyUI，停止等待启动",
          }
        : null,
    probe: () => host.probeComfyUi(2000),
    isDead: async () => {
      const snap = await getComfyRuntimeSnapshot();
      if (snap.unverified || !snap.didQueryProcTable || snap.running) {
        goneStreak = 0;
        return null;
      }
      goneStreak += 1;
      return goneStreak >= 2
        ? "已在运行的 ComfyUI 实例在等待期间退出。可重新触发启动；详见 log/services/comfyui-runtime.log"
        : null;
    },
  });
  if (result.ok) {
    /* 接管：与入口快路径同款 —— 这个实例不是本次拉起的，补挂退出监督
     * （幂等：已挂着就不重挂）。 */
    ensureKeepAliveWatchOnAdoption({ host, settings, note });
  }
  return result;
}

/**
 * 保活模式：脱离进程树拉起，等就绪只在端口上实探，判死靠限频查进程表。
 * 直连 stdio 不可得，输出重定向到按次命名的文件、由 `tailKeepAliveLog` 增量跟进。
 */
async function launchKeepAliveMode(host: LaunchHost, ctx: EnsureCtx): Promise<EnsureResult> {
  const { note, plan, args, stdioEnv, deadline, timeoutDetail } = ctx;
  const { st, appendRuntimeLog, clearComfyStopping } = host;
  // 保活：脱离进程树。没有直连 stdio/exit，但把 stdout/stderr 重定向到
  // 按次命名的文件里，等待循环会增量跟随进 comfyui-runtime.log ——
  // 保活模式下「启动日志」面板不再空白，完整输出也留得下文件。
  const kaStamp = host.localTimestamp().replaceAll(/[: ]/g, "-");
  const kaOutLog = path.join(SERVICES_LOG_DIR, `comfyui-keepalive-${kaStamp}.out.log`);
  const kaErrLog = path.join(SERVICES_LOG_DIR, `comfyui-keepalive-${kaStamp}.err.log`);
  /* 判死时从本次的重定向日志全文里识别根因：keepAlive 没有直连 stdio，进程
   * 秒退的证据只在这两个按次命名的文件里 —— 此前判死文案是固定的「进程未
   * 出现」，而真实成因（解释器没有 pip/uv、缺依赖）就摆在同一份日志里。 */
  const diagnoseFromRedirectLogs = (): string | null => {
    const lines: Array<string> = [];
    for (const file of [kaErrLog, kaOutLog]) {
      try {
        if (!fs.existsSync(file)) {
          continue;
        }
        lines.push(...fs.readFileSync(file, "utf8").split(/\r?\n/));
      } catch {
        /* 读不到就当没有这一份证据，不影响判死本身 */
      }
    }
    return diagnoseComfyStartupFailure(lines);
  };

  /* 按次命名的重定向文件只建不删会一直堆积，每次新拉起顺手保留最近若干次
   * （在建本次的文件之前清，删到的必定都是历史的）。 */
  pruneKeepAliveLogs();
  const launched = spawnManaged({
    command: plan.cmd,
    args,
    cwd: plan.cwd,
    env: stdioEnv,
    mode: "keepAlive",
    redirectStdoutFile: kaOutLog,
    redirectStderrFile: kaErrLog,
  });
  if (launched.child === undefined) {
    const detail = `启动 ComfyUI 失败：${launched.error}`;
    note(detail);
    return { ok: false, base: null, detail };
  }
  st.stopRequested = false;
  clearComfyStopping();
  appendRuntimeLog(
    `[keepAlive-spawn] cmd=${plan.cmd} args=${JSON.stringify(args)} cwd=${plan.cwd}`,
  );
  appendRuntimeLog(`[keepAlive-spawn] 完整输出重定向：${kaOutLog} 与 ${kaErrLog}`);
  /* 会话开始标记：pid 这里拿不到（真实进程是 Start-Process 的孙进程），退出
   * 监督器见到它时会知道「活了多久」，对账只关心「有没有结局」。 */
  host.markSessionStart({ pid: null, mode: "keepAlive" });
  /* 中介 powershell「立即」退出；Start-Process 参数被拒等拉起失败都发生在
   * 中介里（目标进程根本没被拉起）。等它退出并带出 stderr，失败立刻报错
   * 返回 —— 否则会跌进下面无 deadline 的端口轮询，把「启动中…」挂死。 */
  const mediator = await waitForDetachMediator(launched.child);
  if (mediator.code !== null && mediator.code !== 0) {
    const detail = `启动 ComfyUI 失败（保活拉起被拒）：${
      mediator.stderr.trim() || `powershell 退出码 ${mediator.code}`
    }`;
    note(detail);
    return { ok: false, base: null, detail };
  }

  /* CPU 档位（ISSUE #1959）：keepAlive 路径**拿不到**子进程句柄（Windows 上是
   * Start-Process 的孙进程、POSIX 上已 unref），PID 只能按 `main.py` 反查。
   * 而反查要等进程真的出现在进程表里（解释器冷启动要几秒），所以这里起一条
   * **有界重试**：查到就施加、施加完即停；始终查不到就如实说一句。
   *
   * 为什么不做成「等就绪后施加」：就绪可能要几分钟（加载大模型），而优先级
   * 越早调上越好 —— 冷启动那一段本身就是 CPU 密集型（import torch / 读权重）。 */
  fireAndForget(
    resolveAndApplyCpuLimitForKeepAlive({
      mainPy: plan.mainPy,
      mode: ctx.cpuLimitMode,
      note,
    }),
    /* 失败通道：这条链内部已把「查不到 PID」收成一行 note，落到这里的只有
     * 意料外的异常（改判据时的 bug），所以只需要让它**有**一条出口、
     * 不静默消失（硬规则 4）。 */
    (err) => {
      note(
        `CPU 档位施加链路异常（不影响启动）：${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );

  const spawnAt = Date.now();
  let everSeenProcess = false;
  let missCount = 0;
  let lastProcessCheckAt = 0;
  /* 重定向 stderr 里出现「端口被占」即置位：本次拉起的进程绑定失败已死，
   * 继续等只会被占端口的那个实例「冒领」就绪（实测现场）。 */
  let portConflict = false;
  /* 重定向文件的增量跟随游标：把新字节按行带进 comfyui-runtime.log。
   *
   * `kaCarry` 是**字符级**的残余（ISSUE #1959 的乱码根因）：按字节游标读一段
   * 区间时，区间两端完全可能落在某个中文字符的中间，而那段中文字符占 3 字节
   * —— 各自 `toString("utf-8")` 会得到两串 U+FFFD（面板上就是「乱码」）。
   * ComfyUI 的刷屏频率远高于本循环的 1s 节拍，所以这不是罕见情形。
   * 解码与留存交给 `~/lib/log/utf8-incremental`（纯函数、穷举切点验过）。 */
  const kaOffsets = { out: 0, err: 0 };
  const kaCarry: { err: Uint8Array; out: Uint8Array } = {
    out: new Uint8Array(0),
    err: new Uint8Array(0),
  };
  const tailKeepAliveLog = (file: string, key: "out" | "err") => {
    try {
      if (!fs.existsSync(file)) {
        return;
      }
      const stat = fs.statSync(file);
      if (stat.size < kaOffsets[key]) {
        kaOffsets[key] = 0;
      } // 文件被重置
      if (stat.size <= kaOffsets[key]) {
        return;
      }
      const len = stat.size - kaOffsets[key];
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, buf, 0, len, kaOffsets[key]);
      fs.closeSync(fd);
      kaOffsets[key] = stat.size;
      /* 拼回上一轮的残余再解：切在多字节字符中间时，那个字符整个留到下一轮
       * （见文件头）。**先取新残余再切片** —— 改回 `buf.toString("utf-8")`
       * 就是把这条修复撤掉。 */
      const decoded = decodeIncremental(kaCarry[key], buf);
      kaCarry[key] = decoded.carry;
      for (const line of decoded.text.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (isPortConflictLine(trimmed)) {
          portConflict = true;
        }
        if (trimmed.trim()) {
          appendRuntimeLog(
            `[${key}] ${clampText(trimmed, { maxLength: INLINE_STDERR_MAX, marker: "" })}`,
          );
        }
      }
    } catch {
      /* 文件尚未创建 / 读取抖动：下一轮再试 */
    }
  };

  /* 保活路径不设 st.child（真实子进程不是我们能可靠持有/杀掉的——Windows
   * 上是 Start-Process 的孙进程，POSIX 上虽能拿到 pid 但已 unref）。
   * 「关闭 ComfyUI」与「进程秒退」都不再走 child 判断，只靠端口探测。 */
  const result = await waitForComfyReady({
    deadline,
    timeoutDetail,
    readyDetail: "ComfyUI 已启动并就绪（保活模式）",
    onReady: (base) => {
      note(`ComfyUI 已就绪（保活）：${base}`);
    },
    onDead: (detail) => {
      appendRuntimeLog("■ ComfyUI 保活进程已退出");
      note(detail);
    },
    earlyExit: () => {
      if (st.stopRequested === true) {
        return {
          ok: false,
          base: null,
          detail: "已手动关闭 ComfyUI，停止等待启动",
        };
      }
      /* 「端口被占」在重定向 stderr 里现身后，本次拉起的进程已经死了；
       * 再等下去，就绪判定只会被占端口的那个实例应答冒领。立即中止，
       * caller（runEnsureLaunch）据此转「等待已有实例就绪」。 */
      if (portConflict) {
        return { ok: false, base: null, detail: portConflictExitDetail() };
      }
      return null;
    },
    /* 每轮先把新输出跟进日志，再做就绪探测。 */
    probe: async () => {
      tailKeepAliveLog(kaOutLog, "out");
      tailKeepAliveLog(kaErrLog, "err");
      // 端口可达即视为就绪（保活实例无法用「本进程 PID 监听端口」去锁定，
      // 用 /system_stats 实探，避免把同机另一个 ComfyUI 误认成本次拉起的）。
      return host.probeComfyUi(2000);
    },
    /* 失败兜底出口：宽限期后按限频检查进程表，**连续 2 次**都找不到运行
     * main.py 的进程才判死 —— 单次查询在冷启动高负载下可能超时误报
     * （进程其实活着），此前误报过「秒退」。 */
    isDead: async () => {
      const now = Date.now();
      if (
        !shouldCheckKeepAliveProcess({
          sinceSpawnMs: now - spawnAt,
          sinceLastCheckMs: now - lastProcessCheckAt,
          graceMs: COMFY_KEEPALIVE_GRACE_MS,
          intervalMs: COMFY_KEEPALIVE_PROCESS_CHECK_INTERVAL_MS,
        })
      ) {
        return null;
      }
      lastProcessCheckAt = now;
      /* findPidForMainPyDetailed 区分「查不到」与「查询失败」：机器忙（ComfyUI
       * 出图）时 PowerShell 进程表查询会超时，那时不应误判成「保活进程已退出」。 */
      const lookup = await findPidForMainPyDetailed(plan.mainPy);
      if (lookup.failed) {
        return null;
      }
      if (lookup.pid !== null) {
        everSeenProcess = true;
        missCount = 0;
        return null;
      }
      missCount += 1;
      if (!isKeepAliveDead(missCount)) {
        return null;
      }
      const common =
        "详见 log/services/comfyui-runtime.log；也可暂时勾选「关闭应用时连带关闭 ComfyUI」改用直连启动，获得实时日志定位问题。";
      const head = everSeenProcess
        ? "ComfyUI 启动失败：保活进程已退出。"
        : "ComfyUI 启动失败：保活拉起后进程未出现。";
      /* 识别出的根因（pip/uv 缺失、缺依赖）拼进文案：让失败直接说「该动哪个
       * 环境」，而不是只留一句「进程未出现」让人翻日志。识别不出就回落固定文案。 */
      const diag = diagnoseFromRedirectLogs();
      return diag === null ? `${head}${common}` : `${head}${diag}。${common}`;
    },
  });
  if (!result.ok) {
    note(result.detail);
    /* 端口冲突的失败带上机器可读标记：caller 不把它当终态失败，而是转
     * 「等待已有实例就绪」（占着端口的极可能就是另一个 ComfyUI）。 */
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- portConflict 由等待循环内的闭包回调写入，控制流分析看不到，运行期可能已变 true
    return portConflict ? { ...result, portConflict: true } : result;
  }

  /* 就绪之后起**退出监督**：保活模式没有子进程句柄（Windows 上是 Start-Process
   * 的孙进程、POSIX 上已 unref），「它什么时候没的」只能从外面看进程表 —— 没有
   * 这一条，用户能看到的只有下一次状态轮询里的「未运行」，原因一个字都没有，
   * 正是「莫名退出」这个说法的来源。
   *
   * 重新拉起前先停掉上一次的监督器，否则它会一直盯着旧会话、把新进程当成
   * 「旧的那个回来了」。 */
  startKeepAliveWatch({
    host,
    mainPy: plan.mainPy,
    logs: { out: kaOutLog, err: kaErrLog },
    isStopped: () => st.stopRequested === true,
    note,
  });
  return result;
}

/** 当前保活会话的退出监督器（同一时刻最多一个，重新拉起前会被停掉）。 */
let keepAliveExitWatcher: { stop: () => void } | null = null;

/**
 * 保活退出监督的统一装配入口：「本次会话拉起」与「重启后接管」两条路径共用。
 * 同一时刻最多一个监督器 —— 重新拉起前会先停掉上一个，否则它会一直盯着旧
 * 会话、把新进程当成「旧的那个回来了」。
 */
function startKeepAliveWatch(params: {
  host: LaunchHost;
  isStopped: () => boolean;
  /** 崩溃尾部来源（本次拉起的重定向文件；接管场景给不出来时留空 ——
   *  监督照常工作，只是退出时带不出尾部）。 */
  logs?: { err?: string; out?: string };
  mainPy: string;
  note: (msg: string) => void;
}): void {
  keepAliveExitWatcher?.stop();
  keepAliveExitWatcher = startComfyExitWatcher({
    findPid: () => findPidForMainPyDetailed(params.mainPy),
    isStopped: params.isStopped,
    onExit: (facts) => {
      const report = reportKeepAliveExit({
        facts,
        stopRequested: params.isStopped(),
        appendRuntimeLog: params.host.appendRuntimeLog,
        log: params.note,
        keepAliveLogs: params.logs,
      });
      params.host.markSessionEnd(report);
      /* 监督器已自停：清掉引用，之后若这个实例又活了（外部/别处拉起），
       * 「接管」路径能重新挂上监督。 */
      keepAliveExitWatcher = null;
    },
  });
}

/**
 * 找 SERVICES_LOG_DIR 里最新的一对 `comfyui-keepalive-*.{out,err}.log`。
 *
 * 用于「接管」场景：那个实例不是本进程拉起的，拿不到它当次的重定向文件路径，
 * 只能按 mtime 取最近被写入的那份（还在跑的实例还在写，基本就是它）。
 * 取不到就返回空对象 —— 退出时带不出尾部，但监督本身照常。
 */
function findLatestKeepAliveLogs(): { err?: string; out?: string } {
  try {
    if (!fs.existsSync(SERVICES_LOG_DIR)) {
      return {};
    }
    const pick = (suffix: string): string | undefined => {
      const newest = fs
        .readdirSync(SERVICES_LOG_DIR)
        .filter((name) => name.startsWith("comfyui-keepalive-") && name.endsWith(suffix))
        .map((name) => ({
          name,
          mtime: fs.statSync(path.join(SERVICES_LOG_DIR, name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)[0];
      if (!newest) {
        return undefined;
      }
      return path.join(SERVICES_LOG_DIR, newest.name);
    };
    return { out: pick(".out.log"), err: pick(".err.log") };
  } catch {
    return {};
  }
}

/** 保活重定向日志的保留份数（一次拉起 = out + err 两个文件）。 */
const KEEPALIVE_LOG_KEEP_LAUNCHES = 10;

/**
 * 只保留最近 N 次保活拉起的重定向日志，删掉更老的。
 *
 * 这些文件是**按次命名**的（`comfyui-keepalive-<时间戳>.{out,err}.log`）：好处
 * 是不会被长持句柄锁死、不会互相覆盖，代价是**只建不删**——每次拉起都新增两个，
 * 长期用会在 `log/services/` 里一直堆积（AGENTS 硬规则 4 要的就是这种产物
 * 「按次命名 + 轮转」，光有命名没有轮转仍会堆积）。
 *
 * 每次新拉起顺手清一次最老的：保留的是 mtime 最新的那些，因此
 *   - 本次刚建的（最新）不会被自己删掉；
 *   - 仍在运行、还在被写入的实例（mtime 靠前）也不会被删。
 * 清理失败不该影响启动本身，故整体吞掉异常。
 */
export function pruneKeepAliveLogs(): void {
  try {
    if (!fs.existsSync(SERVICES_LOG_DIR)) {
      return;
    }
    const files = fs
      .readdirSync(SERVICES_LOG_DIR)
      .filter(
        (name) =>
          name.startsWith("comfyui-keepalive-") &&
          (name.endsWith(".out.log") || name.endsWith(".err.log")),
      )
      .map((name) => ({
        name,
        mtime: fs.statSync(path.join(SERVICES_LOG_DIR, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of files.slice(KEEPALIVE_LOG_KEEP_LAUNCHES * 2)) {
      fs.unlinkSync(path.join(SERVICES_LOG_DIR, old.name));
    }
  } catch {
    /* 清理失败不影响启动 */
  }
}

/**
 * 「接管」场景补挂保活退出监督：应用重启后复用了上一次会话拉起的保活实例
 * （或实例由外部启动），那次拉起发生在上一个进程里，本次会话的
 * `launchKeepAliveMode` 根本没机会给它装监督器 —— 于是它之后真没了就只剩
 * 状态轮询里的「未运行」，原因一个字都没有，正是「保活莫名退出」的来源。
 *
 * 只在保活策略下生效（bound 模式有子进程句柄，退出由直连的 exit 事件落）。
 * 幂等：状态轮询 / WS 重连会反复走到这里，监督器一旦挂上就不再重挂 —— 重挂
 * 会把「进程开头时间」重置成最后一次轮询的时刻，存活时长就失真了。
 */
export function ensureKeepAliveWatchOnAdoption(input: {
  host: LaunchHost;
  note: (msg: string) => void;
  settings: ReturnType<typeof getSettingsSync>;
}): void {
  const { host, settings, note } = input;
  if (resolveLaunchPolicy(getExitPolicy().exitKillComfyui) !== "keepAlive") {
    return;
  }
  if (keepAliveExitWatcher !== null) {
    return;
  }
  const plan = resolveComfyLaunchPlan(settings.comfyuiPath);
  if ("error" in plan) {
    return;
  }
  startKeepAliveWatch({
    host,
    mainPy: plan.mainPy,
    logs: findLatestKeepAliveLogs(),
    isStopped: () => host.st.stopRequested === true,
    note,
  });
}

/**
 * bound 模式：直连 spawn（与父同组），stdio 直管，等就绪靠「已知子进程 PID
 * 的监听端口 + /system_stats」双重确认。
 */
async function launchBoundMode(host: LaunchHost, ctx: EnsureCtx): Promise<EnsureResult> {
  const { note, plan, args, stdioEnv, deadline, timeoutDetail } = ctx;
  const { st, appendRuntimeLog, clearComfyStopping } = host;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(plan.cmd, args, {
      cwd: plan.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // 不隐藏控制台：python.exe 会弹出一个窗口，实时显示 ComfyUI 的启动/打印输出，
      // 方便排查问题（请勿改回 windowsHide: true，否则看不到日志）。
      windowsHide: false,
      // 强制 Python UTF-8 模式：中文 Windows（GBK/CP936 代码页）上，自定义
      // 节点 print 含 emoji 等非 GBK 字符会抛 UnicodeEncodeError 导致进程
      // 崩溃（exit=1）。PYTHONIOENCODING 覆盖 stdout/stderr 编码，
      // PYTHONUTF8 启用 Python 3.7+ UTF-8 模式。
      env: stdioEnv,
    });
  } catch (error) {
    const detail = errorText(error, "启动 ComfyUI 失败");
    note(detail);
    return { ok: false, base: null, detail };
  }
  st.child = child;
  // bound 是普通 spawn（与父同组），POSIX 上拿不到独立进程组 → 单杀兜底。
  st.childDetached = false;
  st.stopRequested = false;
  clearComfyStopping();
  appendRuntimeLog(
    `[spawn] pid=${child.pid} cmd=${plan.cmd} args=${JSON.stringify(args)} cwd=${plan.cwd}`,
  );
  host.markSessionStart({ pid: child.pid ?? null, mode: "bound" });
  /* CPU 档位（ISSUE #1959）：bound 路径亲手持有子进程，PID 直接可信 ——
   * 起进程后立刻施加，不等就绪（理由见 applyCpuLimitAsync）。 */
  applyCpuLimitAsync({
    pid: child.pid ?? null,
    mode: ctx.cpuLimitMode,
    note,
  });

  // 最近输出留底：进程秒退时从里面提取「No module named 'X'」给出可行动的报错
  const ledger = createRecentOutputLedger();
  const outSink = createOutputSink({
    appendRuntimeLog,
    pushRecent: ledger.push,
  });
  child.stdout?.on("data", outSink);
  child.stderr?.on("data", outSink);
  /* 会话起点：存活时长基于它算（「跑了 3 分钟就死」与「刚起就死」是两种问题）。 */
  const spawnedAt = Date.now();
  child.on(
    "exit",
    createChildExitHandler({
      /* 横幅直接写「为什么退出」：此前只有 `code=...`，而用户的问题是
       * 「它是由什么退出的」—— 结论该出现在日志里，不该留给读者去推。 */
      subject: "ComfyUI",
      appendRuntimeLog,
      log: note,
      clearChild: () => {
        if (st.child === child) {
          st.child = undefined;
        }
      },
      context: () => ({
        pid: child.pid ?? null,
        uptimeMs: Date.now() - spawnedAt,
        stopRequested: st.stopRequested === true,
        mode: "bound",
      }),
      onExitReport: (report) => {
        host.markSessionEnd(report);
      },
    }),
  );

  /* 等待循环：deadline 为 null（设置页手动启动）时不设硬超时，一直等到
   * 就绪、进程退出或用户手动关闭；显式传 timeoutMs 的调用方（任务自动
   * 启动）到点后照旧放弃本次等待。 */
  const result = await waitForComfyReady({
    deadline,
    timeoutDetail,
    readyDetail: "ComfyUI 已启动并就绪",
    onReady: (base) => {
      note(`ComfyUI 已就绪：${base}`);
    },
    /* 用户点了「关闭 ComfyUI」→ 退出循环（child 也会随之消失）。放在
     * child 判断之前，避免把主动关闭误报成「进程启动后立即退出」。 */
    earlyExit: () =>
      st.stopRequested === true
        ? { ok: false, base: null, detail: "已手动关闭 ComfyUI，停止等待启动" }
        : null,
    probe: () => probeChildReady(child),
    /* 子进程句柄被清掉（= 进程已退出）→ 用留底给出可行动的报错。 */
    isDead: () => Promise.resolve(st.child === child ? null : buildEarlyExitDetail(ledger.lines)),
  });
  if (!result.ok) {
    note(result.detail);
  }
  return result;
}

/**
 * bound 模式的一次就绪探测：用已知子进程 PID 查它实际监听的端口——不依赖
 * 端口探测猜哪个 ComfyUI 是我们的实例（别的实例可能占着配置端口导致自动
 * +1）。用「特定 PID 的监听端口 + /system_stats 响应」双重确认，避免把同
 * 网段上另一个 ComfyUI 实例误认作刚启动的配置实例。
 */
export async function probeChildReady(child: ReturnType<typeof spawn>): Promise<string | null> {
  const childPid = child.pid;
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  const listenPort = childPid == null ? null : await findPidListeningPort(childPid);
  if (listenPort === null) {
    return null;
  }
  const base = comfyUiBaseUrl(listenPort);
  try {
    const r = await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      return base;
    }
  } catch {
    /* HTTP 探测失败——进程在但 /system_stats 还没响应，继续等 */
  }
  return null;
}
