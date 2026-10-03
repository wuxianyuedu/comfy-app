"use client";

import { cloneElement, type ReactElement, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * Hint —— 「给一个控件配悬停提示」的**全库唯一出口**（规范 16 §16.2.3 P82 /
 * shadcn `composition.md`：icon-only 与「悬停看解释」走 Tooltip，不走原生 `title=`）。
 *
 * **为什么不直接写 `<Tooltip>` 三件套**：形态固定（Trigger 必用 Base UI 的
 * `render` prop 接管子元素，不用 `asChild`），逐点手写会在视图里长出几十份
 * 近似结构（§12.12 孪生判据）。这里收一次，调用点只多一对标签。
 *
 * **原生 `title=` 的三个短板**（本出口要替掉它的原因）：
 *   · 读屏器对 `title` 的支持长期不一致（Safari + VoiceOver 直接忽略），
 *     可见文案与可访问名因此两套；
 *   · 显示延迟与样式都不受主题控制（浏览器灰底、移动端不显示）；
 *   · 不能挂 `kbd` / 富文本。
 *
 * **两条与规范 §6.1 的接缝**（原生 `title` 在图标按钮上兼职充当可访问名，
 * 搬走文案不等于搬走名字）：
 *   · 有可见文字的按钮**不要**给 `aria-label` —— 名字已由文字给出，另写一份
 *     会撞 WCAG 2.5.3「label in name」；
 *   · 纯图标按钮（`<X />`、`✕`、`⋮` 这类**不含字母与数字**的字形）传
 *     `accessibleName`，由本组件把 `label` 同时写成子元素的 `aria-label`
 *     （子元素已自带时不覆盖）；
 *   · 带字母或数字的就是**可见文字**（`A-`、`5×`、「错误」），一律不补名 ——
 *     名字该由文字自己给，另写一份会让读屏念出的与屏幕上看到的不一致
 *     （WCAG 2.5.3「label in name」，语音控制用户念屏幕上那个词就点不到）。
 *
 * **禁用态按钮**：trigger 落在 `disabled` 元素上时浏览器根本不发指针事件、提示
 * 不会弹（原生 `title` 反而会弹）。传 `wrap` 让提示挂在一层 `inline-flex` 锚点
 * 上，「为什么不能点」就还能说出口；代价是键盘聚焦不再触发提示 —— 与原生
 * `title=` 的既有行为一致，不算退化。
 *
 * **一个副作用要说清**：`data-slot` 会被 trigger 接管 —— 被包的 `<Button>` 上
 * 那个 `data-slot="button"` 变成 `data-slot="tooltip-trigger"`（同一个属性写两遍，
 * trigger 侧后施加、把它盖掉了）。全库没有任何样式或门禁按 `[data-slot=button]`
 * 取元素（`ui/button-group` 用的是 `button-group` / `select-trigger` 两个别的
 * 名字），所以不影响外观；但**按 `data-slot` 断言「这是不是基元按钮」的用例要
 * 同时接受 `tooltip-trigger`**，别把它当成手写 `<button>` 的残留。
 *
 * **不要拿本组件当别的触发器的 `render` 承载体**（ISSUE #1384）。`Hint` 只吃上面
 * 那五个 props、**不转发任意 props**，而 menu / popover / select 那批基元的
 * `Trigger` 是靠把自身触发 props（`aria-haspopup` / pointerdown / keyboard 处理）
 * 灌进 `render` 收到的元素来接管子元素的。于是
 * `render={<Hint label="…"><Button/></Hint>}` 这种写法会把那串 props 丢在 `Hint`
 * 门口 —— 按钮长着按钮的样子却点不开浮层（`aria-haspopup` 也不在），`data-slot`
 * 反而照旧是 `tooltip-trigger`，很容易被误读成「接管成功」。
 * 正确顺序只能是**别的 trigger 在内、`Hint` 在外**：两层 `render` 会**合并**到
 * 同一颗子元素上（`<Hint><DropdownMenuTrigger render={<Button/>} /></Hint>`），
 * 互不吞并。回归判据：`TopBar.test.tsx` 的 `aria-haspopup` 断言（jsdom 能判，
 * 因为它是渲染结果）+ `e2e/top-bar-app-menu.spec.ts`（菜单真的弹出来只能真浏览器判）。
 */
export interface HintProps {
  /**
   * 提示文案。传 `undefined` / `""` / `false` 时整条提示不生效（不渲染浮层、
   * trigger 置 `disabled`）—— 这一档是给 `title={cond ? "说明" : undefined}`
   * 这类条件态调用点留的，调用处不必写两份 JSX。
   */
  label?: ReactNode;
  /** 弹出方向，默认 `top`。密集工具条上被裁切时按容器改档。 */
  side?: "top" | "bottom" | "left" | "right";
  /** 纯图标按钮：把 `label` 同时写进子元素的 `aria-label`（已有则不覆盖）。 */
  accessibleName?: boolean;
  /** 被提示的控件带 `disabled` 时置真：提示挂到外层锚点，禁用态也能弹。 */
  wrap?: boolean;
  /** 被提示的控件本身（`<Button>` 或做锚点的元素），必须是单个元素。 */
  children: ReactElement<{ "aria-label"?: string }>;
}

function isEmptyLabel(label: ReactNode): boolean {
  return (
    label === undefined || label === null || label === "" || label === false
  );
}

function Hint({
  label,
  side = "top",
  accessibleName = false,
  wrap = false,
  children,
}: HintProps) {
  const empty = isEmptyLabel(label);
  /* 补名只在「字符串文案 + 子元素没写 aria-label」时做：富文本 label 当名字
   * 会被读屏器整段念成长串，而已有 aria-label 是调用处更精确的判断。 */
  const autoName =
    accessibleName &&
    !empty &&
    typeof label === "string" &&
    children.props["aria-label"] === undefined
      ? label
      : null;
  const target =
    autoName !== null
      ? cloneElement(children, { "aria-label": autoName })
      : children;
  const trigger = wrap ? <span className="inline-flex">{target}</span> : target;

  return (
    <Tooltip disabled={empty}>
      <TooltipTrigger render={trigger} />
      {empty ? null : <TooltipContent side={side}>{label}</TooltipContent>}
    </Tooltip>
  );
}

export { Hint };
