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
