import { overlayClass } from "~/lib/full-screen-layer";

/**
 * `ui/dialog` / `ui/sheet` / `ui/fullscreen-dialog` 遮罩（Backdrop）的 class 串：**必须在一处定义**（`DialogContent` 与 `SheetContent` 共用同一份），且是可脱离 React 单测的纯常量（规范 17 §17.2 第①层）。
 * 底色用语义 token `bg-scrim` 而非写死 `bg-black/*`（ISSUE #1742：结构性表面，浅/深主题各自取值，由 `tests/dialog-backdrop-contrast.test.ts` 从编译产物真量）；遮罩必须带 `top-title-bar` 让位标题行（ISSUE #310：曾铺满视口盖住页签与窗口按钮，用户关不掉也切不回）。
 * `check-title-bar-clearance.cjs` 与 `check-inline-style.cjs` 要求「铺满视口 + 顶部让位」落在**同一行**的同一个 class 串里，故统一走 `overlayClass("modal")`，而不是自己拼两套互相打架的定位。
 */
export function dialogBackdropClass(className?: string): string {
  /* 顶部让位优先：`top-title-bar` 与「铺满视口」同时出现时，前者的 `top`
     覆盖后者的 `top: 0`，即遮罩从标题行下方开始（判据 ① 只看同一行）。 */
  return overlayClass(
    "modal",
    `fixed top-title-bar inset-0 z-modal bg-scrim duration-100 supports-backdrop-filter:backdrop-blur-xs ${className ?? ""}`,
  );
}
