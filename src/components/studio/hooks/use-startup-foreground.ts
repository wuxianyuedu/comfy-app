"use client";

// ── 启动完成后的前台归属（应用挂载时执行一次）
// 判据：**用户在启动期有没有手动让出前台** —— 没让出就顶到前台，让出了才只显示到任务栏。
// 该判据在壳的 `show_main_window_without_focus` 里、窗口显示前执行（launch-and-build.md §1.3）；
// 本 hook 只管另一条通道：壳带 COMFYAPP_FOREGROUND=1 时挂载再补一次，否则二次启动没反应。
// 分层（规范 17）：壳调用在 ~/lib/desktop-shell-client，判据在 ~/lib/startup-foreground。

import { useEffect, useRef } from "react";
import { activateMainWindow, shouldActivateWindowOnLaunch } from "~/lib/shell/desktop-shell-client";

/**
 * 挂载时按启动标记决定是否把主窗口唤到前台。只跑一次（启动期行为），
 * 之后窗口显隐完全由用户操作决定。
 *
 * **卸载取消 + 静默降级**（ISSUE #3568）：答复壳是一个异步命令，而路由切页 /
 * StrictMode 首轮清理会让组件在答复落地前就卸载。原先的 `void then(...)` 两条
 * 都没管：卸载后仍补前台（把用户从刚切过去的窗口拉回来），命令 reject 则变成
 * 未处理 rejection。壳侧 `take_startup_activation()` 已经保证「只放行第一次」，
 * 这一层补的是**同一条链的时间边界**。
 *
 * **同一组件实例只问壳一次**：StrictMode 会把 effect 跑两遍（同一实例、ref 不变），
 * 若各自问一次，首轮就消费掉壳的一次性标记、又因卸载被取消，活着的第二轮拿到
 * `false` ⇒ 开发模式反而丢掉这次补前台。用 ref 共享同一份答复即可两全；真正的
 * 路由重挂是新实例，会再问一次，但那次壳答复必然是 `false`。
 */
export function useStartupForeground(): void {
  const activation = useRef<{ handled: boolean; pending: Promise<boolean> | null }>({
    handled: false,
    pending: null,
  });
  useEffect(() => {
    const slot = activation.current;
    let cancelled = false;
    void (async () => {
      try {
        slot.pending ??= shouldActivateWindowOnLaunch();
        const shouldActivate = await slot.pending;
        if (shouldActivate && !slot.handled && !cancelled) {
          slot.handled = true;
          await activateMainWindow();
        }
      } catch {
        // 壳命令不可用 / 非壳环境由 `desktop-shell-client` 自行降级；这里只兜住
        // 异常，不让启动期的补前台动作变成未处理的 rejection。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
