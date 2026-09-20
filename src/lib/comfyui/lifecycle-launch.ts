/* ── ComfyUI 启动编排（ISSUE #570 第 1~3 项）──────────────────────────
 *
 * 从 `lifecycle.ts` 拆出的「拉起 + 等待就绪」：`ensureComfyUiReady` 原先是一个
 * 405 行函数，内含 288 行 IIFE 与三个不可测回调。这里保留**机制**，
 * `lifecycle.ts` 只留「取事实 → 判决 → 交付」。
 *
 * 两条路径（keepAlive / bound）共用 `waitForComfyReady` 的策略注入等待循环：
 * 差别只在探测方式与判死方式，循环体与超时文案只有一份。
 *
 * 与宿主的耦合（`st` 单例、运行日志、横幅、清除「关闭中」标记）经
 * {@link LaunchHost} 注入，而不是回引 `lifecycle.ts` —— 后者会成环（§12.7）。
 */

import { errorText } from "~/lib/error-message";
import "server-only";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getExitPolicy } from "../app-settings/app-settings.server";
import { COMFYUI_DEFAULT_PORT } from "../endpoints";
import type { getSettingsSync } from "../app-settings/app-settings.server";
import { resolveComfyLaunchPlan } from "./launch-path";
import { resolveEffectiveLaunch } from "./desktop-instance";
import { findPidForMainPy, findPidListeningPort } from "./proc-detect";
import {
  spawnManaged,
  waitForDetachMediator,
} from "~/lib/process/process-launch";
import { SERVICES_LOG_DIR } from "~/lib/log/log-paths";
import {
  buildEarlyExitDetail,
  buildSpawnArgs,
  isKeepAliveDead,
  resolveLaunchPolicy,
  shouldCheckKeepAliveProcess,
} from "./lifecycle-derive";
import {
  createChildExitHandler,
  createOutputSink,
  createRecentOutputLedger,
  waitForComfyReady,
} from "./lifecycle-wait";

export type EnsureResult = { ok: boolean; base: string | null; detail: string };

/** 保活启动的进程存在性检查：宽限期（解释器冷启动也要时间）后才首次检查，
 *  之后限频复查 —— 防止把「正在启动」误判为「没起来」，也避免每轮轮询
 *  都扫一次进程表。 */
const COMFY_KEEPALIVE_GRACE_MS = 15_000;
const COMFY_KEEPALIVE_PROCESS_CHECK_INTERVAL_MS = 5_000;

/** 宿主提供的能力（`lifecycle.ts` 注入；本模块不反向 import 它）。 */
export interface LaunchHost {
  /** 启动单飞锁与子进程句柄（HMR 单例）。 */
  st: {
    child?: ReturnType<typeof spawn>;
    childDetached?: boolean;
    stopRequested?: boolean;
  };
  /** 写 comfyui-runtime.log 一行。 */
  appendRuntimeLog: (line: string) => void;
  /** 写会话边界横幅。 */
  appendSessionBanner: (kind: "start" | "end", title: string) => void;
  /** 清掉「关闭中」标记（进程已确认退出 / 用户重新点了启动）。 */
  clearComfyStopping: () => void;
  /** 本地时间戳（保活重定向文件名用）。 */
  localTimestamp: () => string;
  /** 探测 ComfyUI 是否可达（注入以避免 `本模块 → lifecycle.ts` 的循环依赖）。 */
  probeComfyUi: (timeoutMs?: number) => Promise<string | null>;
}

/** 启动编排的上下文：把「怎么记日志」「探到多少事实」显式传下去，让两条
 *  启动路径（keepAlive / bound）与等待循环都不再闭包捕获 `ensureComfyUiReady`
 *  的局部状态 —— 这正是 ISSUE #570 第 1~3 项要拆掉的那 288 行 IIFE。 */
type EnsureCtx = {
  /** 记一条日志（logger + onLog + 运行日志文件）。 */
  note: (msg: string) => void;
  /** 解析出的启动计划（cmd / args / cwd / mainPy）。 */
  plan: { cmd: string; cwd: string; mainPy: string };
  /** 最终启动参数（已含 --port / --enable-cors-header / 额外参数）。 */
  args: string[];
  /** 子进程环境（含 PYTHONIOENCODING / PYTHONUTF8 / 桌面实例 envVars）。 */
  stdioEnv: NodeJS.ProcessEnv;
  /** 硬超时绝对时间戳；null = 不设硬超时。 */
  deadline: number | null;
  /** 超时未就绪文案（**唯一一处**，两条路径共用）。 */
  timeoutDetail: string;
};

/**
 * 拉起后的编排入口：按退出策略选 keepAlive 或 bound，两者共用同一套等待原语。
 * 拆出来是为了让 `ensureComfyUiReady` 只留「取事实 → 判决 → 交付」，
 * 启动机制本身（含 288 行 IIFE）不再挤在同一个函数里。
 */
export async function runEnsureLaunch(input: {
  host: LaunchHost;
  settings: ReturnType<typeof getSettingsSync>;
  timeoutMs?: number | null;
  note: (msg: string) => void;
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
    comfyuiPort: settings.comfyuiPort ?? 0,
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
  const keepAlive =
    resolveLaunchPolicy(getExitPolicy().exitKillComfyui) === "keepAlive";
  // 每次启动先在日志里落一条明显的会话分隔横幅（ANSI 亮绿），
  // 让日志面板能一眼分清「上次启动的结尾」和「这次启动的开头」。
  host.appendSessionBanner("start", "▶ ComfyUI 启动会话");
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
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
    deadline: input.timeoutMs != null ? Date.now() + input.timeoutMs : null,
    timeoutDetail: `ComfyUI 启动超过 ${Math.round((input.timeoutMs ?? 0) / 1000)}s 仍未就绪，继续留在后台观察；详见 log/services/comfyui-runtime.log`,
  };
  return keepAlive
    ? launchKeepAliveMode(host, ctx)
    : launchBoundMode(host, ctx);
}

/**
 * 保活模式：脱离进程树拉起，等就绪只在端口上实探，判死靠限频查进程表。
 * 直连 stdio 不可得，输出重定向到按次命名的文件、由 `tailKeepAliveLog` 增量跟进。
 */
async function launchKeepAliveMode(
  host: LaunchHost,
  ctx: EnsureCtx,
): Promise<EnsureResult> {
  const { note, plan, args, stdioEnv, deadline, timeoutDetail } = ctx;
  const { st, appendRuntimeLog, appendSessionBanner, clearComfyStopping } =
    host;
  // 保活：脱离进程树。没有直连 stdio/exit，但把 stdout/stderr 重定向到
  // 按次命名的文件里，等待循环会增量跟随进 comfyui-runtime.log ——
  // 保活模式下「启动日志」面板不再空白，完整输出也留得下文件。
  const kaStamp = host.localTimestamp().replace(/[: ]/g, "-");
  const kaOutLog = path.join(
    SERVICES_LOG_DIR,
    `comfyui-keepalive-${kaStamp}.out.log`,
  );
  const kaErrLog = path.join(
    SERVICES_LOG_DIR,
    `comfyui-keepalive-${kaStamp}.err.log`,
  );
  const launched = spawnManaged({
    command: plan.cmd,
    args,
    cwd: plan.cwd,
    env: stdioEnv,
    mode: "keepAlive",
    redirectStdoutFile: kaOutLog,
    redirectStderrFile: kaErrLog,
  });
  if (!launched.child || launched.error) {
    const detail = `启动 ComfyUI 失败：${launched.error ?? "未知错误"}`;
    note(detail);
    return { ok: false, base: null, detail };
  }
  st.stopRequested = false;
  clearComfyStopping();
  appendRuntimeLog(
    `[keepAlive-spawn] cmd=${plan.cmd} args=${JSON.stringify(args)} cwd=${plan.cwd}`,
  );
  appendRuntimeLog(
    `[keepAlive-spawn] 完整输出重定向：${kaOutLog} 与 ${kaErrLog}`,
  );
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

  const spawnAt = Date.now();
  let everSeenProcess = false;
  let missCount = 0;
  let lastProcessCheckAt = 0;
  /* 重定向文件的增量跟随游标：把新字节按行带进 comfyui-runtime.log */
  const kaOffsets = { out: 0, err: 0 };
  const tailKeepAliveLog = (file: string, key: "out" | "err") => {
    try {
      if (!fs.existsSync(file)) return;
      const stat = fs.statSync(file);
      if (stat.size < kaOffsets[key]) kaOffsets[key] = 0; // 文件被重置
      if (stat.size <= kaOffsets[key]) return;
      const len = stat.size - kaOffsets[key];
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, buf, 0, len, kaOffsets[key]);
      fs.closeSync(fd);
      kaOffsets[key] = stat.size;
      for (const line of buf.toString("utf-8").split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed.trim())
          appendRuntimeLog(`[${key}] ${trimmed.slice(0, 500)}`);
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
    onReady: (base) => note(`ComfyUI 已就绪（保活）：${base}`),
    onDead: (detail) => {
      // 保活进程已消失：落一条会话结束横幅，标记该会话终点。
      appendSessionBanner("end", "■ ComfyUI 保活进程已退出");
      note(detail);
    },
    earlyExit: () =>
      st.stopRequested
        ? { ok: false, base: null, detail: "已手动关闭 ComfyUI，停止等待启动" }
        : null,
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
      if (await findPidForMainPy(plan.mainPy)) {
        everSeenProcess = true;
        missCount = 0;
        return null;
      }
      missCount += 1;
      if (!isKeepAliveDead(missCount)) return null;
      const common =
        "详见 log/services/comfyui-runtime.log；也可暂时勾选「关闭应用时连带关闭 ComfyUI」改用直连启动，获得实时日志定位问题。";
      return everSeenProcess
        ? `ComfyUI 启动失败：保活进程已退出。${common}`
        : `ComfyUI 启动失败：保活拉起后进程未出现。${common}`;
    },
  });
  if (!result.ok) note(result.detail);
  return result;
}

/**
 * bound 模式：直连 spawn（与父同组），stdio 直管，等就绪靠「已知子进程 PID
 * 的监听端口 + /system_stats」双重确认。
 */
async function launchBoundMode(
  host: LaunchHost,
  ctx: EnsureCtx,
): Promise<EnsureResult> {
  const { note, plan, args, stdioEnv, deadline, timeoutDetail } = ctx;
  const { st, appendRuntimeLog, appendSessionBanner, clearComfyStopping } =
    host;
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
  } catch (e) {
    const detail = errorText(e, "启动 ComfyUI 失败");
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

  // 最近输出留底：进程秒退时从里面提取「No module named 'X'」给出可行动的报错
  const ledger = createRecentOutputLedger();
  const outSink = createOutputSink({
    appendRuntimeLog,
    pushRecent: ledger.push,
  });
  child.stdout?.on("data", outSink);
  child.stderr?.on("data", outSink);
  child.on(
    "exit",
    createChildExitHandler({
      // 会话结束横幅（ANSI 亮黄）：无论自然退出还是用户手动关闭，
      // 都在日志里明确划上会话终点，方便区分前后两次启动。
      banner: (code) => `■ ComfyUI 进程已退出（code=${String(code)}）`,
      appendSessionBanner: (b) => appendSessionBanner("end", b),
      log: note,
      clearChild: () => {
        if (st.child === child) st.child = undefined;
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
    onReady: (base) => note(`ComfyUI 已就绪：${base}`),
    /* 用户点了「关闭 ComfyUI」→ 退出循环（child 也会随之消失）。放在
     * child 判断之前，避免把主动关闭误报成「进程启动后立即退出」。 */
    earlyExit: () =>
      st.stopRequested
        ? { ok: false, base: null, detail: "已手动关闭 ComfyUI，停止等待启动" }
        : null,
    probe: () => probeChildReady(child),
    /* 子进程句柄被清掉（= 进程已退出）→ 用留底给出可行动的报错。 */
    isDead: async () =>
      st.child !== child ? buildEarlyExitDetail(ledger.lines) : null,
  });
  if (!result.ok) note(result.detail);
  return result;
}

/**
 * bound 模式的一次就绪探测：用已知子进程 PID 查它实际监听的端口——不依赖
 * 端口探测猜哪个 ComfyUI 是我们的实例（别的实例可能占着配置端口导致自动
 * +1）。用「特定 PID 的监听端口 + /system_stats 响应」双重确认，避免把同
 * 网段上另一个 ComfyUI 实例误认作刚启动的配置实例。
 */
export async function probeChildReady(
  child: ReturnType<typeof spawn>,
): Promise<string | null> {
  const childPid = child.pid;
  const listenPort = childPid ? await findPidListeningPort(childPid) : null;
  if (!listenPort) return null;
  const base = `http://127.0.0.1:${listenPort}`;
  try {
    const r = await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) return base;
  } catch {
    /* HTTP 探测失败——进程在但 /system_stats 还没响应，继续等 */
  }
  return null;
}
