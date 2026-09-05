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
import { COMFYUI_DEFAULT_PORT, getSettingsSync, saveSettings } from "../app-settings";
import { resolveComfyBase } from "./client";
import { logger } from "~/server/lib/logger";
import { resolveComfyLaunchPlan } from "./launch-path";
import { findPidListeningPort } from "./proc-detect";

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
};
const G_KEY = "__comfyLifecycle_v1";
const g = globalThis as unknown as Record<string, LifecycleGlobal | undefined>;
const st: LifecycleGlobal = g[G_KEY] ?? {};
g[G_KEY] = st;

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
 */
export async function stopComfyUiProcess(): Promise<{ ok: boolean; detail: string }> {
  const child = st.child;
  const pid = child?.pid;
  // 本应用未拉起过进程：仍探测一次，若外部启动的 ComfyUI 在跑，报告「需手动关闭」
  const stillUp = await probeComfyUi(1500);
  if (!pid) {
    return stillUp
      ? { ok: false, detail: "ComfyUI 不是由本应用启动的，请在 ComfyUI 自己的窗口/终端中手动关闭" }
      : { ok: true, detail: "ComfyUI 未在运行" };
  }
  await new Promise<void>((resolve) => {
    if (process.platform === "win32") {
      exec(`taskkill /PID ${pid} /T /F`, () => resolve());
    } else {
      try {
        child.kill("SIGTERM");
      } catch { /* already dead */ }
      resolve();
    }
  });
  st.child = undefined;
  // 给进程一点退出时间，再探测确认
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!(await probeComfyUi(800))) {
      return { ok: true, detail: "ComfyUI 已关闭" };
    }
  }
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

/** 把 extraArgs 字符串切成参数数组（支持双引号包裹含空格的路径）。 */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? "");
  return out;
}

function appendRuntimeLog(line: string): void {
  try {
    const dir = path.join(process.cwd(), "log");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "comfyui-runtime.log"), `${new Date().toISOString()} ${line}\n`, "utf-8");
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/**
 * 确保 ComfyUI 可用：可达则直接返回；不可达且配置了路径 + 自动启动时，
 * 拉起进程并轮询等待就绪。单飞锁保证并发任务/WS 重连只触发一次启动。
 */
export async function ensureComfyUiReady(
  opts: { timeoutMs?: number; onLog?: (msg: string) => void } = {}
): Promise<EnsureResult> {
  // 冷启动（尤其带大量自定义节点 / CUDA 初始化的重安装）从拉起到绑定端口常需
  // 3-7 分钟；180s 太短会让应用在 ComfyUI 仍在加载时就误报「超时未就绪」，
  // 用户看到的就是「一直黑屏 / 打不开页面」。默认放宽到 7 分钟。
  const timeoutMs = opts.timeoutMs ?? 420_000;
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

    // 端口优先取设置里的 comfyuiPort（设置界面明确配置的监听端口），
    // 其次兼容旧的 comfyuiUrl 端口段；都为空 = ComfyUI 默认 8188。
    // 非默认端口显式传 --port，并把最终端口同步回 comfyuiUrl，
    // 保证「界面配置端口 = 实际监听端口 = 客户端连接端口」三者一致。
    let port = COMFYUI_DEFAULT_PORT;
    if (settings.comfyuiPort && settings.comfyuiPort > 0) {
      port = settings.comfyuiPort;
    } else {
      try {
        const u = new URL(settings.comfyuiUrl);
        port = parseInt(u.port) || COMFYUI_DEFAULT_PORT;
      } catch { /* keep default */ }
    }
    const args = [...plan.baseArgs, ...(port !== COMFYUI_DEFAULT_PORT ? ["--port", String(port)] : []), ...splitArgs(settings.comfyuiExtraArgs)];
    try {
      const u = new URL(settings.comfyuiUrl);
      if (parseInt(u.port) !== port) {
        u.port = String(port);
        await saveSettings({ comfyuiUrl: u.toString() });
      }
    } catch { /* invalid comfyuiUrl — leave as-is */ }

    note(`ComfyUI 未运行，按配置路径启动：${plan.cmd} ${args.join(" ")}`);
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
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });
    } catch (e) {
      const detail = `启动 ComfyUI 失败：${e instanceof Error ? e.message : String(e)}`;
      note(detail);
      return { ok: false, base: null, detail };
    }
    st.child = child;
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

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
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
      await new Promise((r) => setTimeout(r, 2000));
    }
    const detail = `ComfyUI 启动超过 ${Math.round(timeoutMs / 1000)}s 仍未就绪，详见 log/comfyui-runtime.log`;
    note(detail);
    return { ok: false, base: null, detail };
  })();

  try {
    return await st.starting;
  } finally {
    st.starting = undefined;
  }
}
