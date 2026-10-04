import type { Meta, StoryObj } from "@storybook/nextjs";

import { dialogBackdropClass } from "~/components/ui/dialog-overlay";

/**
 * `dialogBackdropClass()` 是 `ui/dialog` / `ui/sheet` 两份遮罩（Backdrop）的
 * **class 串唯一出处**。
 *
 * 为什么它值得单独一份 story：遮罩的样式是「**删掉 JSX 还能跑的判据**」
 * （规范 17 §17.2 第①层），可以脱离 React 单测 —— 而它同时要满足一条硬规则：
 *
 * > **遮罩必须让出应用级标题行**（ISSUE #310）。遮罩曾铺满整个视口，
 * > 把页签与右上角窗口按钮一起盖住 —— 用户关不掉、也切不回其它页签。
 *
 * 判据 `check-title-bar-clearance.cjs` 描到「铺满视口」的定位声明时，
 * 要求**同一行**必须有 `top-title-bar`；而「同一段 class 串里既有铺满视口、
 * 又有 `top-title-bar`」是自相矛盾的写法（后写的 `top` 覆盖前者），
 * 所以它统一走 `overlayClass("modal", …)` 这个常量函数 ——
 * 静态判据与运行时形态由此是同一个来源。
 *
 * 所以这份 story 展示的是**它算出来的字符串**（这是本模块的全部对外面），
 * 以及带上调用处 `className` 之后的结果。真形态请在 `Dialog` / `Sheet`
 * 的 story 里看遮罩。
 */
const meta = {
  title: "UI/DialogOverlay",
  component: OverlayClassDemo,
  render: () => <OverlayClassDemo />,
} satisfies Meta<typeof OverlayClassDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

function OverlayClassDemo() {
  return (
    <div className="flex w-184 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          dialogBackdropClass() —— 不传参数
        </span>
        <pre className="rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
          {dialogBackdropClass()}
        </pre>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          dialogBackdropClass(&quot;bg-black/40&quot;) —— 全屏视图那一档
        </span>
        <pre className="rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
          {dialogBackdropClass("bg-black/40")}
        </pre>
      </div>
      <p className="text-ink-muted text-xs">
        两行里都同时有「铺满视口」与 <code>top-title-bar</code> ——
        后者覆盖前者的 顶部偏移，遮罩因此从标题行下方开始。这也是
        <code>check-title-bar-clearance.cjs</code> 要求的同一行形态。
      </p>
    </div>
  );
}

/** 默认档：`ui/dialog` / `ui/sheet` 用的那一份（`bg-black/10` +
  `supports-backdrop-filter:backdrop-blur-xs`），由上面那条 `render` 给出。 */
export const Default: Story = {};

/** 调用处传 `className`：全屏视图把它换成更重的 `bg-black/40`
 *  —— 同一份遮罩、只有底色不同，这正是「收口一处」的意义。 */
export const WithCustomClass: Story = {
  render: () => (
    <div className="flex w-184 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-muted font-mono text-[11px]">
          dialogBackdropClass(&quot;bg-black/40&quot;)
        </span>
        <pre className="rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">
          {dialogBackdropClass("bg-black/40")}
        </pre>
      </div>
      <p className="text-ink-muted text-xs">
        真形态：打开任意一条 <code>Dialog</code> 或 <code>Sheet</code> 的
        story， 看遮罩是否让出了页面顶部的标题行。
      </p>
    </div>
  ),
};
