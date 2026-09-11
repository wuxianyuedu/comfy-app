"use client";

// ── 启动完成后的前台归属（应用挂载时执行一次）──────────────────────────
//
// ISSUE #359：应用启动要几十秒，用户往往在这段时间切去别的窗口干活。启动完成
// 若是照直把窗口顶到最前面，正在看的内容就被打断。默认策略改为「只显示到任务栏
// + 任务栏闪烁提示」（Rust 壳的 `show_main_window_without_focus`），用户自己
// 点开；只有「用户再次启动已运行的实例」（壳带 COMFYAPP_FOREGROUND=1）或
// 「前台本来就是本应用」才在挂载时把自己顶到前台——否则再点一次启动还是没反应。
//
// 分层（规范 17）：壳调用收敛在 `~/lib/desktop-shell-client`，判据在
// `~/lib/startup-foreground`（纯函数），本 hook 只做「读标记 → 调一次」。

import { useEffect } from "react";
import {
  activateMainWindow,
  shouldActivateWindowOnLaunch,
} from "~/lib/desktop-shell-client";

/**
 * 挂载时按启动标记决定是否把主窗口唤到前台。只跑一次（启动期行为），
 * 之后窗口显隐完全由用户操作决定。
 */
export function useStartupForeground(): void {
  useEffect(() => {
    // 判据在壳进程里（前端读不到非 NEXT_PUBLIC_ 前缀的环境变量），因此问壳；
    // 非壳环境返回 false——浏览器里窗口归属本来就由用户决定。
    void shouldActivateWindowOnLaunch().then((activate) => {
      if (activate) void activateMainWindow();
    });
  }, []);
}
