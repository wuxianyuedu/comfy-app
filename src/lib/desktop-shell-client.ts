// 桌面壳（Tauri）能力封装：壳内开窗 / 环境探测。
//
// 前端页面既可能跑在 Tauri 壳里（WebView），也可能跑在浏览器（纯 web / dev）。
// 本模块集中封装「只有壳里才有的能力」，浏览器环境调用返回不可用，避免各
// 视图层散落 `window.__TAURI__` 探测与动态 import。
//
// 归属：这是壳交互（桌面侧能力），放 src/lib/<domain>-client.ts（AGENTS.md
// 硬规则 9：视图层不得新增 IO，壳/网络调用统一进 lib 客户端）。

/** Tauri v2 注入到每个 WebView 的全局标记键；浏览器环境不存在。 */
const SHELL_INTERNALS_KEY = "__TAURI_INTERNALS__";

/** 是否运行在 Tauri 壳里（WebView）。浏览器环境无对应全局标记。 */
export function isDesktopShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    SHELL_INTERNALS_KEY in window ||
    "__TAURI__" in window
  );
}

export type ShellOpenResult = { ok: boolean; detail: string };

/**
 * 在桌面壳内打开一个指向 url 的独立窗口，相当于壳内「子页签」。
 * 由 Rust 侧 open_comfyui_window 命令承载；非壳环境返回不可用，调用方应
 * 回退到系统浏览器。返回 ok=false 时 detail 给出可读原因。
 */
export async function openUrlInShell(url: string): Promise<ShellOpenResult> {
  if (!isDesktopShell()) {
    return { ok: false, detail: "当前不在桌面壳内，无法在壳内开窗" };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const detail = await invoke<string>("open_comfyui_window", { url });
    return { ok: true, detail };
  } catch (e) {
    return {
      ok: false,
      detail: `壳内打开失败：${e instanceof Error ? e.message : String(e)}。壳可能需要重编（app.exe 需含 open_comfyui_window 命令），或先改用系统浏览器打开。`,
    };
  }
}

/**
 * 询问壳：本次启动完成后要不要自动把应用窗口给前台。
 *
 * 判据在壳进程里（启动器注入的 `COMFYAPP_FOREGROUND`，见
 * `scripts/start_tauri_launcher.py` 的 decide_foreground）：默认 false——
 * 启动耗时期间用户可能已切去别的窗口，加载完成抢前台会打断他正在看的内容；
 * 只有「前台本来就是本应用 / 用户刚点的启动 / 用户再次唤起运行中的实例」
 * 才为 true。非壳环境（服务端渲染、浏览器）返回 false。
 */
export async function shouldActivateWindowOnLaunch(): Promise<boolean> {
  if (!isDesktopShell()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<boolean>("should_activate_on_launch")) === true;
  } catch {
    return false;
  }
}

/**
 * 把已在任务栏的应用窗口唤到前台（清掉任务栏闪烁提醒）。
 *
 * 用在哪：应用启动时若判定「不抢前台」（用户已切去别的窗口，见
 * `docs/standards/launch-and-build.md` §1），窗口只显示在任务栏并闪烁提示；
 * 之后用户主动唤起本应用（再点一次启动器 / 双击图标）时，壳会把
 * `COMFYAPP_FOREGROUND=1` 注入已运行的实例，应用据此在首次挂载时把自己顶到
 * 前台——否则「再点一次还是没反应」。收件箱这类「用户点了就该看到」的入口
 * 也可以直接复用本函数。
 *
 * 非壳环境 / 命令不可用（旧壳未含 activate_main_window）时静默降级：这不是
 * 用户主动点的动作，失败不该打扰用户。
 */
export async function activateMainWindow(): Promise<boolean> {
  if (!isDesktopShell()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("activate_main_window");
    return true;
  } catch {
    return false;
  }
}
