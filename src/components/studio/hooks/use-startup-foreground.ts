"use client";

// ── 启动完成后的前台归属（应用挂载时执行一次）──────────────────────────
//
// 应用启动要几十秒，用户往往在这段时间切去别的窗口干活。该不该把窗口顶到最
// 前面只有一条判据：**用户在启动期有没有手动让出前台**——没让出（前台还在
// 本壳的窗口上）就把前台给他，让出了才只显示到任务栏 + 闪烁提示。这条判据在
// 壳的 `show_main_window_without_focus` 里、窗口显示之前采样并执行（见
// `docs/standards/launch-and-build.md` §1.3），本 hook 只管另一条通道：壳明确
// 要求给前台时（壳带 COMFYAPP_FOREGROUND=1，如二次启动唤起已运行的实例）
// 在挂载时再补一次——否则再点一次启动还是没反应。
//
// 分层（规范 17）：壳调用收敛在 `~/lib/desktop-shell-client`，判据在
// `~/lib/startup-foreground`（纯函数），本 hook 只做「读标记 → 调一次」。

import { useEffect } from "react";
import {
  activateMainWindow,
  shouldActivateWindowOnLaunch,
} from "~/lib/shell/desktop-shell-client";

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
