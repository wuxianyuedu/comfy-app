"use client";

/* ── TitleBar · 桌面壳的窗口标题行（拖拽区 + 窗口按钮）────────────────
 * 背景（ISSUE #310 / #200）：主窗口关原生装饰（`decorations: false`）后，窗口动作
 * （拖拽 / 最大化 / 关闭）要由应用自己接管，本组件就是那条横条。
 * 「顶部页签栏退役」（ISSUE #4770）：页签不再住在标题行 —— 已打开的视图页签与
 * 内嵌 iframe 页签改在**左侧栏的「临时页签」分组**里列（与其它页签同一套状态），
 * 标题行只剩「拖拽空白区 + 三颗窗口按钮」。浏览器 / dev 没有这条 chrome，
 * 调用方（`ShellTabs`）按 `shouldUseTitleBarTabs` 判据决定挂不挂。
 * 摆放位置（ISSUE #3807）：渲染在 `AppShell` 内容列顶部（经 `TitleBarSlot` 交下来），
 * 不再是整窗第一行，侧栏不必让位。`WindowTitleBar`（整屏路由页）仍是整窗第一行，
 * 那是另一种壳，别把两处的 `data-shell` 让位口径混起来。
 * 拖拽区铺满标题栏，双击空白 = 最大化 / 还原（与系统标题栏一致）。 */

import { TITLE_BAR_CHROME_CLASS, TITLE_BAR_HEIGHT_CLASS } from "~/lib/full-screen-layer";
import { useStartupForeground } from "./hooks/use-startup-foreground";
import { useTitleBarDrag, useWindowMaximized, WindowControls } from "./WindowControls";

/**
 * 窗口控制按钮（最小化 / 最大化-还原 / 关闭）在 `./WindowControls` ——
 * 与整屏路由页自带的精简标题行（`WindowTitleBar`）共用同一份实现，
 * 「最大化 / 还原」图标跟着状态走这种细节不会在两处漂移（§12.12）。
 */
export function TitleBar() {
  /* 最大化状态与拖拽判据走 `./WindowControls` 的共享实现。 */
  const [maximized, setMaximized] = useWindowMaximized();
  const drag = useTitleBarDrag(setMaximized);

  // 启动完成后的前台归属：用户没让出前台就给前台，让出了才只在任务栏显示
  // （判据在壳里，见 §1.3）；本 hook 只管「用户再次唤起已运行的实例」那条通道。
  useStartupForeground();

  return (
    <div
      /* `bg-sidebar/40` + `border-border` + `border-b` + `px-2`：与侧栏同族的底色。
         高度仍取 `--spacing-title-bar`，这样浮层让位（`use-overlay-boundary`）与
         标题行几何还是同一个数。右端三颗窗口按钮是无边框窗口必需的形态。 */
      className={`flex ${TITLE_BAR_HEIGHT_CLASS} ${TITLE_BAR_CHROME_CLASS} border-border bg-sidebar/40 shrink-0 items-stretch border-b px-2 select-none`}
      /* `data-slot="title-bar"` 是「应用顶部这条 chrome 在不在」的机器可读标记：
         `TitleBar` 与精简标题行 `WindowTitleBar` 共用它，e2e 按它断言锚定
         浮层的让位对象确实在（气泡被标题行吃掉半个身子那件事，见
         `~/lib/full-screen-layer` 的「锚定浮层」一节）。 */
      data-slot="title-bar"
      onDoubleClick={drag.onDoubleClick}
      onPointerDown={drag.onPointerDown}
    >
      {/* 拖拽空白区：撑满整条（页签已退役到侧栏，这里只剩拖拽 + 窗口按钮） */}
      <div aria-hidden className="min-w-2 flex-1" />

      {/* 窗口按钮：接管原生标题栏的三个动作（共享实现见 ./WindowControls） */}
      <WindowControls maximized={maximized} onMaximizedChange={setMaximized} />
    </div>
  );
}
