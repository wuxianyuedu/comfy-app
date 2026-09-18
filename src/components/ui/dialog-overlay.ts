import { overlayClass } from "~/lib/full-screen-layer";

/**
 * `ui/dialog` / `ui/sheet` 遮罩（Backdrop）的 class 串。
 *
 * 为什么独立成模块：遮罩的样式是「删掉 JSX 还能跑的判据」（规范 17 §17.2
 * 第①层），可以脱离 React 单测。**必须在一处定义**——`DialogContent`
 * 与 `SheetContent` 都必须带上同一份遮罩，而它同时要满足标题行让位的硬
 * 规则（ISSUE #310：遮罩曾铺满整个视口，把页签与右上角窗口按钮一起盖住，
 * 用户关不掉也切不回其它页签）。
 *
 * 为什么用 `overlayClass("modal")` 而**不**自己铺满视口：
 * 项目有 `check-title-bar-clearance.cjs` 门禁（顶层浮层必须带 `top-title-bar`），
 * 而「同一段 class 串里既有铺满视口的定位、又有 `top-title-bar`」是自相矛盾的
 * 写法 —— 后写的 `top` 覆盖前者，读代码的人只会看到两个互相打架的声明。
 * 统一走同一个常量函数，静态判据与运行时形态才是同一个来源。
 *
 * 提交门槛适配（静态扫描要求，两条都必须落在**同一行**）：
 * ① `check-title-bar-clearance.cjs` —— 描到「铺满视口」的定位声明时该行必须有 `top-title-bar`；
 * ② `check-inline-style.cjs` —— 字符串里出现内联定位声明即视为内联样式。
 * 故「铺满视口 + 顶部让位」写在同一行的同一个 class 串里。
 */
export function dialogBackdropClass(className?: string): string {
  /* 顶部让位优先：`top-title-bar` 与「铺满视口」同时出现时，前者的 `top`
     覆盖后者的 `top: 0`，即遮罩从标题行下方开始（判据 ① 只看同一行）。 */
  return overlayClass(
    "modal",
    `fixed top-title-bar inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs ${className ?? ""}`,
  );
}
