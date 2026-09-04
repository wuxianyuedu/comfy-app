// ComfyUI 生命周期管理：探测、按配置路径启动、等待就绪。
//
// 背景：任务只有在本进程与 ComfyUI 的 WS 连上后才会出队
// （processQueue 在 WS 未 OPEN 时直接 return），ComfyUI 不在运行时任务会
// 在队列里挂 30 秒后被 reaper 判死。此前用户只能自己去手动启动 ComfyUI。
//
// 本模块提供：
//   - probeComfyUi()      HTTP 探测是否可达（复用 resolveComfyBase 的端口探测）
//   - ensureComfyUiReady() 未运行且已配置 comfyuiPath 时拉起进程并等待就绪
//   - isComfyStarting()   reaper 用：启动窗口期内不回收 QUEUED 任务
//   - getComfyUiStatus()  设置页状态/按钮用
//
// HMR 安全：启动单飞锁与子进程句柄挂在 globalThis 上，模块重载不会重复拉起。

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getSettingsSync } from "../app-settings";
import { resolveComfyBase } from "./client";
import { logger } from "~/server/lib/logger";

export type ComfyUiStatus = {
  up: boolean;
  base: string | null;
  starting: boolean;
  pid?: number;
};

type LaunchPlan = {
  cmd: string;
  baseArgs: string[];
  cwd: string;
  mainPy: string;
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

/**
 * 从 comfyuiPath 推导启动命令。支持三种常见布局（详见 app-settings 的注释），
 * 命中不了返回可读的错误信息而不是裸异常。
 */
/**
 * 选择解释器：一律用 python.exe，保留控制台窗口，能实时看到 ComfyUI 的打印输出。
 * 绝不用 pythonw.exe——它会彻底吞掉 stdout/stderr，出问题时看不到任何日志，难以排查。
 * 工坊/工作室只把 ComfyUI 当后端服务（python.exe + main.py 起的是 server，不是桌面版 GUI）。
 */
function resolveInterp(dir: string): string | null {
  const p = path.join(dir, "python.exe");
  return fs.existsSync(p) ? p : null;
}

function resolveLaunchPlan(installDir: string): LaunchPlan | { error: string } {
  const root = path.resolve(installDir);
  const candidates: Array<{ pyDir: string; main: string }> = [
    { pyDir: path.join(root, "python_embeded"), main: path.join(root, "main.py") },
    // ComfyUI Desktop 的 vendor 构建：uv 在 ComfyUI/.venv 里装依赖（含 torch），
    // 必须用这个解释器。standalone-env 只是基础解释器（site-packages 是空的，
    // 直接用它必报 No module named 'torch'）。所以 vendor venv 必须排在 standalone-env 之前。
    { pyDir: path.join(root, "ComfyUI", ".venv", "Scripts"), main: path.join(root, "ComfyUI", "main.py") },
    { pyDir: path.join(root, ".venv", "Scripts"), main: path.join(root, "main.py") },
    { pyDir: path.join(root, "venv", "Scripts"), main: path.join(root, "main.py") },
    // 最后兜底：桌面版基础解释器（无 torch，仅当以上都缺失时才用——多半会启动失败）
    { pyDir: path.join(root, "standalone-env"), main: path.join(root, "ComfyUI", "main.py") },
  ];
  for (const c of candidates) {
    const py = resolveInterp(c.pyDir);
    if (py && fs.existsSync(/*turbopackIgnore: true*/ c.main)) {
      return { cmd: py, baseArgs: ["-s", c.main], cwd: path.dirname(c.main), mainPy: c.main };
    }
  }
  if (!fs.existsSync(root)) {
    return { error: `ComfyUI 路径不存在：${root}（请在设置页检查）` };
  }
  return {
    error:
      `在 ${root} 下找不到可启动的 ComfyUI（需要 main.py + python）。` +
      "支持：python_embeded\\python.exe + main.py（便携版）、standalone-env\\python.exe + ComfyUI\\main.py（桌面版）、.venv\\Scripts\\python.exe + main.py。",
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
    const plan = resolveLaunchPlan(settings.comfyuiPath);
    if ("error" in plan) {
      note(plan.error);
      return { ok: false, base: null, detail: plan.error };
    }

    // 端口取自 comfyuiUrl 配置；ComfyUI 默认 8188，非默认时显式传 --port
    let port = 8188;
    try {
      const u = new URL(settings.comfyuiUrl);
      port = parseInt(u.port) || 8188;
    } catch { /* keep default */ }
    const args = [...plan.baseArgs, ...(port !== 8188 ? ["--port", String(port)] : []), ...splitArgs(settings.comfyuiExtraArgs)];

    note(`ComfyUI 未运行，按配置路径启动：${plan.cmd} ${args.join(" ")}`);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.cmd, args, {
        cwd: plan.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        // 不隐藏控制台：python.exe 会弹出一个窗口，实时显示 ComfyUI 的启动/打印输出，
        // 方便排查问题（请勿改回 windowsHide: true，否则看不到日志）。
        windowsHide: false,
      });
    } catch (e) {
      const detail = `启动 ComfyUI 失败：${e instanceof Error ? e.message : String(e)}`;
      note(detail);
      return { ok: false, base: null, detail };
    }
    st.child = child;
    appendRuntimeLog(`[spawn] pid=${child.pid} cmd=${plan.cmd} args=${JSON.stringify(args)} cwd=${plan.cwd}`);
    child.stdout?.on("data", (d: Buffer) => appendRuntimeLog(`[out] ${d.toString().trimEnd().slice(0, 500)}`));
    child.stderr?.on("data", (d: Buffer) => appendRuntimeLog(`[err] ${d.toString().trimEnd().slice(0, 500)}`));
    child.on("exit", (code) => {
      note(`ComfyUI 进程退出（code=${code ?? "null"}）`);
      if (st.child === child) st.child = undefined;
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (st.child !== child) {
        return { ok: false, base: null, detail: "ComfyUI 进程启动后立即退出，详见 log/comfyui-runtime.log" };
      }
      const base = await probeComfyUi(2000);
      if (base) {
        note(`ComfyUI 已就绪：${base}`);
        return { ok: true, base, detail: "ComfyUI 已启动并就绪" };
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
