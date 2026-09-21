// 桌面壳自定义标题栏的窗口控制能力封装。
//
// 背景：主窗口改用 `decorations: false`（无原生标题栏），页签栏与标题行合并
// 成一条自定义标题栏，因此「拖拽移动窗口」「最小化 / 最大化 / 关闭」「双击
// 标题栏最大化」这些原本由系统标题栏提供的能力，必须由前端调用 Tauri 的
// window API 补齐。浏览器（纯 web / dev）里这些能力不存在，统一在此降级为
// 空操作，避免视图层散落 `window.__TAURI__` 探测（AGENTS.md 硬规则 9）。
//
// 归属：壳交互（桌面侧能力）→ `src/lib/<domain>-client.ts`。

import { isDesktopShell } from "./desktop-shell-client";
import { fireAndForget } from "~/lib/async-action";

/** 窗口最大化状态订阅的取消函数。 */
export type UnlistenFn = () => void;

/**
 * 无需退订时的空取消函数（非壳环境 / 订阅失败降级）。
 * 用具名常量而非内联箭头，既满足「禁空箭头函数体」的 lint 规则，
 * 也让调用方无需分支判断即可 `unlisten()`。
 */
const noopUnlisten: UnlistenFn = () => {
  // 有意为空：没有订阅需要释放，见上方说明。
};

/** 拖动窗口（自定义标题栏按住拖动区时调用）。非壳环境空操作。 */
export async function startWindowDrag(): Promise<void> {
  if (!isDesktopShell()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch {
    // 拖拽失败（如权限缺失）不应影响页面，静默降级。
  }
}

/** 最小化窗口。返回是否真正执行（非壳环境为 false）。 */
export async function minimizeWindow(): Promise<boolean> {
  if (!isDesktopShell()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
    return true;
  } catch {
    return false;
  }
}

/** 在「最大化」与「还原」之间切换，返回切换后的最大化状态（非壳环境 null）。 */
export async function toggleMaximizeWindow(): Promise<boolean | null> {
  if (!isDesktopShell()) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.toggleMaximize();
    return await win.isMaximized();
  } catch {
    return null;
  }
}

/** 关闭窗口。返回是否真正执行。 */
export async function closeWindow(): Promise<boolean> {
  if (!isDesktopShell()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
    return true;
  } catch {
    return false;
  }
}

/** 读当前窗口是否最大化（非壳环境 false）。 */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isDesktopShell()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().isMaximized();
  } catch {
    return false;
  }
}

/**
 * 订阅窗口尺寸变化以同步「最大化 / 还原」按钮图标。
 * 非壳环境返回空取消函数（调用方无需分支判断）。
 */
export async function onWindowResized(
  handler: (maximized: boolean) => void,
): Promise<UnlistenFn> {
  if (!isDesktopShell()) return noopUnlisten;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().onResized(() => {
      // isWindowMaximized 内部已 catch 保证 resolve；但 handler 是 caller
      // 传进来的回调（多半是 setState 之类），它抛的话链尾 reject 就变成
      // unhandledRejection。这里没有面板通道可注入，用户看不到最大化按钮的
      // **当前一次**刷新失败而已，下一帧 resize 事件会再补——fireAndForget
      // 内部已把 onError 自己的 throw 也吞了，是链上最合适的收口点。
      fireAndForget(isWindowMaximized().then(handler), () => {
        // 有意为空：handler 抛只丢本帧刷新，下一帧 resize 事件会再补；
        // fireAndForget 内部已把 onError 自己的 throw 也吞掉，这里就是链尾。
      });
    });
  } catch {
    return noopUnlisten;
  }
}
