// ComfyUI 生命周期管理：探测、按配置路径启动、等待就绪。
//
// 背景：任务只有在本进程与 ComfyUI 的 WS 连上后才会出队
// （processQueue 在 WS 未 OPEN 时直接 return），ComfyUI 不在运行时任务会
// 在队列里挂 30 秒后被 reaper 判死。此前用户只能自己去手动启动 ComfyUI。
//
// 本模块提供：
//   - probeComfyUi()      HTTP 探测是否可达（复用 resolveComfyBase 的端口探测）
//   - ensureComfyUiReady() 未运行且已配置 comfyuiPath 时拉起进程并等待就绪
//   - stopComfyUiProcess() 杀掉 ComfyUI 进程树（设置页「关闭」按钮用）
//   - isComfyStarting()   reaper 用：启动窗口期内不回收 QUEUED 任务
//   - getComfyUiStatus()  设置页状态/按钮用
//
// HMR 安全：启动单飞锁与子进程句柄挂在 globalThis 上，模块重载不会重复拉起。

import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import { COMFYUI_DEFAULT_PORT, getExitPolicy, getSettingsSync } from "../app-settings";
import { resolveComfyBase } from "./client";
import { logger } from "~/server/lib/logger";
import { resolveComfyLaunchPlan } from "./launch-path";
import { resolveEffectiveLaunch } from "./desktop-instance";
import { findPidForMainPy, findPidListeningPort } from "./proc-detect";
import { spawnManaged, waitForDetachMediator } from "../process-launch";

export type ComfyUiStatus = {
  up: boolean;
  base: string | null;
  starting: boolean;
  pid?: number;
};

type EnsureResult = { ok: boolean; base: string | null; detail: string };

type LifecycleGlobal = {
  child?: ReturnType<typeof spawn>;
  starting?: Promise<EnsureResult>;
  /** 用户点了「关闭 ComfyUI」：启动等待循环见到它就中止，不再报「秒退」。 */
  stopRequested?: boolean;
};
const G_KEY = "__comfyLifecycle_v1";
const g = globalThis as unknown as Record<string, LifecycleGlobal | undefined>;
const st: LifecycleGlobal = g[G_KEY] ?? {};
g[G_KEY] = st;

/** 任务自动启动路径的等待上限：到点后放弃本次等待，WS 层稍后重试时会
 *  重新拉起（单飞锁已释放）。设置页手动启动不设上限（见 ensureComfyUiReady）。 */
export const COMFYUI_AUTOSTART_TIMEOUT_MS = 420_000;

/** 保活启动的进程存在性检查：宽限期（解释器冷启动也要时间）后才首次检查，
 *  之后限频复查 —— 防止把「正在启动」误判为「没起来」，也避免每轮轮询
 *  都扫一次进程表。 */
const COMFY_KEEPALIVE_GRACE_MS = 15_000;
const COMFY_KEEPALIVE_PROCESS_CHECK_INTERVAL_MS = 5_000;

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的，
 *  toISOString 的 UTC 在 +8 时区会凭空差出 8 小时。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 探测 ComfyUI 是否可达；成功返回实际可用的 base（可能带端口偏移）。 */
export async function probeComfyUi(timeoutMs = 2500): Promise<string | null> {
  try {
    const base = await resolveComfyBase();
    const r = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? base : null;
  } catch {
    return null;
  }
}

/**
 * 关闭 ComfyUI：杀整棵进程树。
 * Windows 用 `taskkill /PID <pid> /T /F`（cmd 外壳死了不杀子进程会留下
 * python 孤儿锁住端口与日志文件）；POSIX 杀整个进程组（spawn 时未设
 * detached，子进程与父进程同组，退而求其次单杀 + 兜底探测确认）。
 *
 * 两种来源都能关：
 *   - bound（默认）：本进程持着子进程句柄 st.child，直接以其 PID 杀树；
 *   - keepAlive / 重启后接管：本进程没有 st.child（保活实例是 Start-Process
 *     中介拉起的孙进程 / 上一会话遗留的孤儿），改按配置路径的 main.py 在
 *     OS 进程表里定位 PID 再杀树——否则用户点「关闭」只会得到
 *     「不是本应用启动的」而永远关不掉上一会话保活下来的 ComfyUI（ISSUE #100）。
 */
export async function stopComfyUiProcess(): Promise<{ ok: boolean; detail: string }> {
  // 无论有没有本应用拉起的子进程，都先落「用户要求停止」标记：若此刻正有
  // 一个启动等待在跑，等待循环会以「已手动关闭」收尾，而不是误报「进程秒退」。
  st.stopRequested = true;

  // 解析出本应用应负责的 main.py 路径：bound / keepAlive / 重启后接管，
  // 「该关哪个进程」统一由配置路径决定，不依赖是否还握着子进程句柄。
  const settings = getSettingsSync();
  const plan = settings.comfyuiPath
    ? resolveComfyLaunchPlan(settings.comfyuiPath)
    : { error: "未配置 comfyuiPath" };

  // 1) 握着 bound 子进程句柄 → 以其 PID 为准（最可靠，不猜）。
  // 2) 没握句柄但 ComfyUI 仍在跑 → 到 OS 进程表按 main.py 定位 PID，
  //    覆盖 keepAlive（保活实例无 st.child）与「应用退出重启后接管上一会话
  //    保活实例」两种场景（globalThis 状态已被新进程清空）。
  let child = st.child;
  let pid = child?.pid;
  const stillUp = await probeComfyUi(1500);
  if (!pid && stillUp && !("error" in plan)) {
    pid = await findPidForMainPy(plan.mainPy);
    if (pid) child = undefined; // 无句柄，仅用定位到的 PID
  }
  if (!pid) {
    return stillUp
      ? { ok: false, detail: "ComfyUI 在运行但不是本应用（配置路径）启动的，请在 ComfyUI 自己的窗口/终端中手动关闭" }
      : { ok: true, detail: "ComfyUI 未在运行" };
  }

  const kind = child ? "bound 子进程" : "按配置路径定位到的进程";
  appendRuntimeLog(`[stop] 用户要求关闭 ComfyUI，目标：${kind}（pid=${pid}）`);
  await new Promise<void>((resolve) => {
    if (process.platform === "win32") {
      exec(`taskkill /PID ${pid} /T /F`, () => resolve());
    } else {
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch { /* already dead */ }
      } else {
        // 无句柄（keepAlive / 接管场景）：进程已脱离本进程组，只能单杀 PID，
        // 兜底交给下面的「仍未响应」提示让用户手动确认。
        try {
          process.kill(pid, "SIGTERM");
        } catch { /* already dead */ }
      }
      resolve();
    }
  });
  if (st.child === child) st.child = undefined;
  // 给进程一点退出时间，再探测确认
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!(await probeComfyUi(800))) {
      appendRuntimeLog("[stop] ComfyUI 已关闭");
      return { ok: true, detail: "ComfyUI 已关闭" };
    }
  }
  appendRuntimeLog("[stop] 关闭命令已发送，但 ComfyUI 仍在响应");
  return { ok: false, detail: "关闭命令已发送，但 ComfyUI 仍在响应，请手动确认进程已退出" };
}

export function isComfyStarting(): boolean {
  return !!st.starting;
}

export function getComfyUiStatus(): ComfyUiStatus {
  return {
    up: false,
    base: null,
    starting: isComfyStarting(),
    pid: st.child?.pid,
  };
}

function appendRuntimeLog(line: string): void {
  try {
    const dir = path.join(process.cwd(), "log");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "comfyui-runtime.log"), `${localTimestamp()} ${line}\n`, "utf-8");
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/**
 * 确保 ComfyUI 可用：可达则直接返回；不可达且配置了路径 + 自动启动时，
 * 拉起进程并轮询等待就绪。单飞锁保证并发任务/WS 重连只触发一次启动。
 *
 * 等待时长：`opts.timeoutMs` 缺省（undefined / null）= **不设硬超时**，一直
 * 等到就绪或进程退出——冷加载（重安装 / CUDA 初始化）慢起来没有准数，固定
 * 上限会在 ComfyUI 随后就绪时误报「启动超时」。设置页手动启动走无限等待
 * （实时日志可见、可随时手动关闭中止）；任务自动启动路径必须显式传
 * `COMFYUI_AUTOSTART_TIMEOUT_MS`，否则 reaper 的启动窗口会被无限拉长。
 */
export async function ensureComfyUiReady(
  opts: { timeoutMs?: number | null; onLog?: (msg: string) => void } = {}
): Promise<EnsureResult> {
  const note = (msg: string) => {
    logger.info(`[comfyui-lifecycle] ${msg}`);
    opts.onLog?.(msg);
    appendRuntimeLog(msg);
  };

  // 快路径：已经在运行（探测可能有端口偏移，返回真实 base）
  const upBase = await probeComfyUi();
  if (upBase) return { ok: true, base: upBase, detail: "ComfyUI 已在运行" };

  // 单飞：并发调用共享同一次启动
  if (st.starting) {
    note("ComfyUI 正在启动中，等待就绪…");
    return st.starting;
  }

  const settings = getSettingsSync();
  if (!settings.comfyuiAutoStart) {
    return { ok: false, base: null, detail: "ComfyUI 未运行，且未开启自动启动（设置页可开启）" };
  }
  if (!settings.comfyuiPath) {
    return {
      ok: false,
      base: null,
      detail: "ComfyUI 未运行，且未配置安装路径——请到 设置 → 创作后端 填写 ComfyUI 路径",
    };
  }
  st.starting = (async () => {
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
    let port = COMFYUI_DEFAULT_PORT;
    if (eff.port && eff.port > 0) port = eff.port;
    const args = [...plan.baseArgs, ...(port !== COMFYUI_DEFAULT_PORT ? ["--port", String(port)] : []), ...eff.extraArgs];
    const desktopEnv = eff.envVars;

    // 退出策略决定拉起方式：exitKillComfyui=true（默认）→ bound，ComfyUI 挂
    // 在应用进程树内，应用退出连带关闭；false → keepAlive，脱离进程树保活，
    // 下次打开应用直接复用。注意开关只在「拉起时」生效（桌面壳退出是
    // taskkill /T /F 杀整树，退出那一刻没有机会再决定）。
    const policy = getExitPolicy();
    const keepAlive = policy.exitKillComfyui === false;
    note(`ComfyUI 未运行，按配置路径启动：${plan.cmd} ${args.join(" ")}${keepAlive ? "（保活模式：应用退出后不关闭）" : ""}`);

    const deadline = opts.timeoutMs != null ? Date.now() + opts.timeoutMs : null;
    const stdioEnv = {
      ...process.env,
      ...desktopEnv,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    };
    if (keepAlive) {
      // 保活：脱离进程树。没有直连 stdio/exit，就绪与否靠端口探测轮询。
      const launched = spawnManaged({
        command: plan.cmd,
        args,
        cwd: plan.cwd,
        env: stdioEnv,
        mode: "keepAlive",
      });
      if (!launched.child || launched.error) {
        const detail = `启动 ComfyUI 失败：${launched.error ?? "未知错误"}`;
        note(detail);
        return { ok: false, base: null, detail };
      }
      st.stopRequested = false;
      appendRuntimeLog(
        `[keepAlive-spawn] cmd=${plan.cmd} args=${JSON.stringify(args)} cwd=${plan.cwd}`,
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
      let lastProcessCheckAt = 0;
      /* 保活路径不设 st.child（真实子进程不是我们能可靠持有/杀掉的——Windows
       * 上是 Start-Process 的孙进程，POSIX 上虽能拿到 pid 但已 unref）。
       * 「关闭 ComfyUI」与「进程秒退」都不再走 child 判断，只靠端口探测。 */
      while (true) {
        if (st.stopRequested) {
          const detail = "已手动关闭 ComfyUI，停止等待启动";
          note(detail);
          return { ok: false, base: null, detail };
        }
        // 端口可达即视为就绪（保活实例无法用「本进程 PID 监听端口」去锁定，
        // 用 /system_stats 实探，避免把同机另一个 ComfyUI 误认成本次拉起的）。
        const upBase = await probeComfyUi(2000);
        if (upBase) {
          note(`ComfyUI 已就绪（保活）：${upBase}`);
          return { ok: true, base: upBase, detail: "ComfyUI 已启动并就绪（保活模式）" };
        }
        /* 失败兜底出口：宽限期后仍看不到运行 main.py 的进程（或见过但已消失）
         * → 目标进程没起来 / 秒退。手动启动没有 deadline，没有这个出口
         * 「启动中…」会永远挂住。进程表扫描有成本，限频执行。 */
        const now = Date.now();
        if (
          now - spawnAt > COMFY_KEEPALIVE_GRACE_MS &&
          now - lastProcessCheckAt > COMFY_KEEPALIVE_PROCESS_CHECK_INTERVAL_MS
        ) {
          lastProcessCheckAt = now;
          if (await findPidForMainPy(plan.mainPy)) {
            everSeenProcess = true;
          } else {
            const common =
              "详见 log/comfyui-runtime.log；也可暂时勾选「关闭应用时连带关闭 ComfyUI」改用直连启动，获得实时日志定位问题。";
            const detail = everSeenProcess
              ? `ComfyUI 启动失败：保活进程已退出（秒退）。${common}`
              : `ComfyUI 启动失败：保活拉起后进程未出现。${common}`;
            note(detail);
            return { ok: false, base: null, detail };
          }
        }
        if (deadline !== null && Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      const detail = `ComfyUI 启动超过 ${Math.round((opts.timeoutMs ?? 0) / 1000)}s 仍未就绪，继续留在后台观察；详见 log/comfyui-runtime.log`;
      note(detail);
      return { ok: false, base: null, detail };
    }

    // ── bound 模式（默认，随应用退出关闭）：沿用直连 spawn + stdio 日志 ──
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
      const detail = `启动 ComfyUI 失败：${e instanceof Error ? e.message : String(e)}`;
      note(detail);
      return { ok: false, base: null, detail };
    }
    st.child = child;
    st.stopRequested = false;
    appendRuntimeLog(`[spawn] pid=${child.pid} cmd=${plan.cmd} args=${JSON.stringify(args)} cwd=${plan.cwd}`);
    // 最近输出留底：进程秒退时从里面提取「No module named 'X'」给出可行动的报错
    const recentOutput: string[] = [];
    const pushRecent = (text: string) => {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        recentOutput.push(trimmed);
        while (recentOutput.length > 60) recentOutput.shift();
      }
    };
    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString().trimEnd().slice(0, 500);
      appendRuntimeLog(`[out] ${text}`);
      pushRecent(text);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString().trimEnd().slice(0, 500);
      appendRuntimeLog(`[err] ${text}`);
      pushRecent(text);
    });
    child.on("exit", (code) => {
      note(`ComfyUI 进程退出（code=${code ?? "null"}）`);
      if (st.child === child) st.child = undefined;
    });

    /* 等待循环：deadline 为 null（设置页手动启动）时不设硬超时，一直等到
     * 就绪、进程退出或用户手动关闭；显式传 timeoutMs 的调用方（任务自动
     * 启动）到点后照旧放弃本次等待。 */
    while (true) {
      /* 用户点了「关闭 ComfyUI」→ 退出循环（child 也会随之消失）。放在
       * child 判断之前，避免把主动关闭误报成「进程启动后立即退出」。 */
      if (st.stopRequested) {
        const detail = "已手动关闭 ComfyUI，停止等待启动";
        note(detail);
        return { ok: false, base: null, detail };
      }
      if (st.child !== child) {
        const missingMod = /No module named '([^']+)'/.exec(
          recentOutput.join("\n"),
        )?.[1];
        return {
          ok: false,
          base: null,
          detail: missingMod
            ? `ComfyUI 进程启动后立即退出：解释器缺少依赖（No module named '${missingMod}'）——请确认 comfyuiPath 指向装了依赖的环境，或为该环境安装依赖（详见 log/comfyui-runtime.log）`
            : "ComfyUI 进程启动后立即退出，详见 log/comfyui-runtime.log",
        };
      }
      // 用已知子进程 PID 查它实际监听的端口——不依赖端口探测猜哪个 ComfyUI
      // 是我们的实例（别的实例可能占着配置端口导致自动 +1）。
      // 用「特定 PID 的监听端口 + /system_stats 响应」双重确认，避免把同网段
      // 上另一个 ComfyUI 实例误认作刚启动的配置实例。
      const childPid = child.pid;
      const listenPort = childPid ? await findPidListeningPort(childPid) : null;
      if (listenPort) {
        const base = `http://127.0.0.1:${listenPort}`;
        try {
          const r = await fetch(`${base}/system_stats`, {
            signal: AbortSignal.timeout(2000),
          });
          if (r.ok) {
            note(`ComfyUI 已就绪：${base}`);
            return { ok: true, base, detail: "ComfyUI 已启动并就绪" };
          }
        } catch {
          /* HTTP 探测失败——进程在但 /system_stats 还没响应，继续等 */
        }
      }
      if (deadline !== null && Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const detail = `ComfyUI 启动超过 ${Math.round((opts.timeoutMs ?? 0) / 1000)}s 仍未就绪，继续留在后台观察；详见 log/comfyui-runtime.log`;
    note(detail);
    return { ok: false, base: null, detail };
  })();

  try {
    return await st.starting;
  } finally {
    st.starting = undefined;
  }
}
