// 桌面壳（Tauri）能力封装：环境探测 / 窗口唤起。
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
  if (typeof window === "undefined") {
    return false;
  }
  return SHELL_INTERNALS_KEY in window || "__TAURI__" in window;
}

/* 注：这里曾有一个 `openUrlInShell` —— 调 Rust `open_comfyui_window` 在壳内
 * 另开一个独立窗口。**已删除，不要再加回来**：ISSUE #310 用户明确要求
 * 「不要打开另一个窗口，我只要多页签的形式」，应用内不再有任何「另开窗口」
 * 的入口。ComfyUI 改为内嵌进同一窗口的页签（放行由启动参数
 * `--enable-cors-header` 保证，见 `src/lib/comfyui/lifecycle-derive.ts`）。
 * Rust 侧 `open_comfyui_window` 命令保留未删（无调用方），避免动壳编译。 */

/**
 * 询问壳：本次启动完成后要不要自动把应用窗口给前台。
 *
 * 判据在壳进程里（`COMFYAPP_FOREGROUND`，见壳的
 * `decide_front_when_self_launched()`）：显式注入（脚本 / 终端调用、
 * `--cold-start`、用户再次唤起运行中的实例）时为 true。**双击启动这一路壳不注入**，
 * 它由壳在窗口显示那一刻按「用户在启动期有没有手动让出前台」现判（见
 * `docs/standards/launch-and-build.md` §1.3）——所以这里返回 false 不等于
 * 「窗口会留在后台」。非壳环境（服务端渲染、浏览器）返回 false。
 */
export async function shouldActivateWindowOnLaunch(): Promise<boolean> {
  if (!isDesktopShell()) {
    return false;
  }
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
 * 用在哪：应用启动时若判定「不抢前台」（用户在启动期手动让出了前台，见
 * `docs/standards/launch-and-build.md` §1.3），窗口只显示在任务栏并闪烁提示；
 * 之后用户主动唤起本应用（再点一次启动器 / 双击图标）时，壳会把
 * `COMFYAPP_FOREGROUND=1` 注入已运行的实例，应用据此在首次挂载时把自己顶到
 * 前台——否则「再点一次还是没反应」。收件箱这类「用户点了就该看到」的入口
 * 也可以直接复用本函数。
 *
 * 非壳环境 / 命令不可用（旧壳未含 activate_main_window）时静默降级：这不是
 * 用户主动点的动作，失败不该打扰用户。
 */
export async function activateMainWindow(): Promise<boolean> {
  if (!isDesktopShell()) {
    return false;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("activate_main_window");
    return true;
  } catch {
    return false;
  }
}

/** 壳在「应用首帧之前」注入的加载占位标记（见 src-tauri/src/lib.rs 的
 *  MAIN_LOADING_STUB_JS）：导航一发起主窗画面就离开启动页，而应用首帧要等
 *  next dev 首次编译，这段时间的 WebView2 空白 / 内嵌错误页由这个占位顶住。 */
const LOADING_STUB_ID = "__comfyapp_loading_stub";

/**
 * 清掉壳注入的启动期加载占位，并停掉它自我重贴的定时器。
 *
 * **为什么应用侧要主动清**：占位为了在白屏 / 内嵌错误页（它们会换掉整个 DOM）
 * 之后仍顶得住，自带一个每 400ms 重贴一次的定时器；而它只认一个固定在 window
 * 上的标记，应用侧不主动收，占位就会在真界面画好之后又盖回来。应用这边只有
 * 这一行清理逻辑，判据与注入端（MAIN_LOADING_STUB_JS）同源，登记在
 * docs/standards/launch-and-build.md 的「启动等待期画面唯一出口」一节。
 *
 * 非壳环境（浏览器）没有占位，静默返回。
 */
export function clearLaunchLoadingStub(): void {
  if (typeof window === "undefined") {
    return;
  }
  const w = /* SAFETY: 类型断言已复核 */ window as unknown as {
    __comfyappStubTimer?: number;
  };
  if (w.__comfyappStubTimer) {
    window.clearInterval(w.__comfyappStubTimer);
    w.__comfyappStubTimer = 0;
  }
  document.getElementById(LOADING_STUB_ID)?.remove();
}

/**
 * 这个壳带不带调试能力（= 编译期有没有 `devtools` feature）。
 *
 * 判据在壳进程里（`devtools_available` 命令）：Tauri 的 `open_devtools()` 门在
 * `#[cfg(any(debug_assertions, feature = "devtools"))]` 后面，而本仓库的壳一律是
 * `cargo build --release` 编的（`debug_assertions` 恒为 false）——**有没有这个
 * feature 才是唯一判据**，前端猜不出来，只能问。
 *
 * 用途：决定「打开开发者工具」入口要不要渲染。发布壳不带该 feature 时入口不出现，
 * 而不是出现了点一下必然报错。非壳环境（浏览器 / dev server）返回 false。
 *
 * 结果**在一次会话内不变**（feature 是编译期的），所以调用方可以放心缓存。
 */
export async function devtoolsAvailable(): Promise<boolean> {
  if (!isDesktopShell()) {
    return false;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<boolean>("devtools_available")) === true;
  } catch {
    // 旧壳没有这个命令：按「不可用」处理，入口不显示（而不是显示一个坏按钮）。
    return false;
  }
}

/**
 * 打开当前 webview 的开发者工具（DevTools）。
 *
 * 调壳命令 `open_devtools`（Rust 侧见 src-tauri/src/lib.rs 的同名函数）：
 * `@tauri-apps/api` v2 **没有** `openDevtools()` 这一方法，所以走应用自有命令，
 * 而不是 `getCurrentWebview().openDevtools()` 之类的（不存在的）内置出口。
 *
 * 返回 `boolean` 表示是否真的打开了，失败**静默降级**为 false：这是开发者手动
 * 触发的调试动作，失败不该弹错误打断当前操作（调用方一般只在 debug 壳里暴露入口）。
 * 非壳环境 / 未启用该 feature 的壳都返回 false。
 */
export async function openDevtools(): Promise<boolean> {
  if (!isDesktopShell()) {
    return false;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_devtools");
    return true;
  } catch {
    return false;
  }
}

/**
 * 读回「应用服务为什么结束」这条记录的**原文**（`run/app-service-exit.json`）。
 *
 * ## 为什么这条路必须存在（ISSUE #1915）
 *
 * 探测「应用服务在不在」打的是 `GET /api/dev/server-id` —— 那是**应用服务自己**
 * 的 HTTP。它一不在，这条通道必然不通，于是经 HTTP 读同一份记录的
 * `GET /api/dev/last-exit` 也一并没了。原先只有这一条读法，结果就是「断开时只能
 * 说时刻、恢复时才可能说出原因」，而恢复那条还常因「那次断开没留下记录」而只能说
 * 读不到 —— 用户看到的是「原因明明已经写在 run/app-service-exit.json 里，界面上
 * 却什么都没有」。
 *
 * 壳进程活得好好的（正是「窗口还在、页面连不上」那一档），它读这个文件不经过任何
 * 应用服务。所以断开那一刻就该经这条通道把原因取回来。
 *
 * 返回**文件原文**而非解析后的对象：形状与文案只在 `./app-service-exit` 一处
 * （走同一个 `parseAppServiceExitRecord`），Rust 那边不重复解析。
 *
 * 非壳环境（浏览器 / dev server）回 null —— 没有这条通道，界面维持原样，**不编
 * 一个「未知原因」出来**。旧壳没有这个命令时同样回 null（降级路径，见
 * `invoke` 的 catch）。
 */
export async function readAppServiceExitRecord(): Promise<string | null> {
  if (!isDesktopShell()) {
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string | null>("get_app_service_exit");
    return typeof raw === "string" && raw.trim() !== "" ? raw : null;
  } catch {
    return null;
  }
}
