"use client";

// ── 启动完成后的前台归属（应用挂载时执行一次）
// 判据：**用户在启动期有没有手动让出前台** —— 没让出就顶到前台，让出了才只显示到任务栏。
// 该判据在壳的 `show_main_window_without_focus` 里、窗口显示前执行（launch-and-build.md §1.3）；
// 本 hook 只管另一条通道：壳带 COMFYAPP_FOREGROUND=1 时挂载再补一次，否则二次启动没反应。
// 分层（规范 17）：壳调用在 ~/lib/desktop-shell-client，判据在 ~/lib/startup-foreground。

import { useEffect } from "react";
import { activateMainWindow, shouldActivateWindowOnLaunch } from "~/lib/shell/desktop-shell-client";

/**
 * 挂载时按启动标记决定是否把主窗口唤到前台。只跑一次（启动期行为），
 * 之后窗口显隐完全由用户操作决定。
 */
export function useStartupForeground(): void {
  useEffect(() => {
    // 判据在壳进程里（前端读不到非 NEXT_PUBLIC_ 前缀的环境变量），因此问壳；
    // 非壳环境返回 false——浏览器里窗口归属本来就由用户决定。
    void shouldActivateWindowOnLaunch().then((activate) => {
      if (activate) {
        void activateMainWindow();
      }
    });
  }, []);
}
