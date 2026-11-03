"use client";

import { cloneElement, type ReactElement, type ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

/** Hint —— 「给一个控件配悬停提示」的全库唯一出口（规范 16 §16.2.3 P82 / shadcn `composition.md`：icon-only 与「悬停看解释」走 Tooltip，不走原生 `title=`）。
 * 不直接写 `<Tooltip>` 三件套：形态固定（Trigger 必用 Base UI 的 `render` prop 接管子元素，不用 `asChild`），逐点手写会在视图里长出几十份近似结构（§12.12 孪生判据）。原生 `title=` 的三个短板：读屏器支持长期不一致（Safari + VoiceOver 忽略，可见文案与可访问名两套）、显示延迟与样式不受主题控制、不能挂 kbd / 富文本。
 * §6.1 接缝：① 有可见文字的按钮不要给 `aria-label`（另写一份会撞 WCAG 2.5.3「label in name」）；② 纯图标按钮（`<X />`、`✕`、`⋮` 这类不含字母与数字的字形）传 `accessibleName`，本组件把 `label` 同时写进子元素 `aria-label`（自带则不覆盖）；③ 带字母或数字的就是可见文字（`A-`、`5×`、「错误」），一律不补名。禁用态 trigger 落在 disabled 元素上时不发指针事件、提示不弹，传 `wrap` 挂到 inline-flex 锚点才能说「为什么不能点」，代价是键盘聚焦不再触发（与原生 title= 一致，不算退化）。
 * 副作用：`data-slot` 会被 trigger 接管（`data-slot="button"` → `"tooltip-trigger"`，同属性后写覆盖）；全库没有按 `[data-slot=button]` 取元素的样式或门禁，但按 `data-slot` 断言「是不是基元按钮」的用例要同时接受 `tooltip-trigger`。
 * 不要拿本组件当别的触发器的 `render` 承载体（ISSUE #1384）：`Hint` 只吃五个 props、不转发任意 props，而 menu / popover / select 的 Trigger 靠灌入自身触发 props（aria-haspopup / pointerdown / keyboard）接管子元素；`render={<Hint ...><Button/></Hint>}` 会把这串 props 丢在门口（按钮点不开浮层、aria-haspopup 也不在）。正确顺序是别的 trigger 在内、`Hint` 在外（两层 render 合并到同一子元素，互不吞并）；回归判据 `TopBar.test.tsx` 的 aria-haspopup 断言 + `e2e/top-bar-app-menu.spec.ts`。 */
export type HintProps = {
  /** 纯图标按钮：把 `label` 同时写进子元素的 `aria-label`（已有则不覆盖）。 */
  accessibleName?: boolean;
  /** 被提示的控件本身（`<Button>` 或做锚点的元素），必须是单个元素。 */
  children: ReactElement<{ "aria-label"?: string }>;
  /**
   * 提示文案。传 `undefined` / `""` / `false` 时整条提示不生效（不渲染浮层、
   * trigger 置 `disabled`）—— 这一档是给 `title={cond ? "说明" : undefined}`
   * 这类条件态调用点留的，调用处不必写两份 JSX。
   */
  label?: ReactNode;
  /** 弹出方向，默认 `top`。密集工具条上被裁切时按容器改档。 */
  side?: "top" | "bottom" | "left" | "right";
  /** 被提示的控件带 `disabled` 时置真：提示挂到外层锚点，禁用态也能弹。 */
  wrap?: boolean;
};

function isEmptyLabel(label: ReactNode): boolean {
  return label === undefined || label === null || label === "" || label === false;
}

function Hint({ label, side = "top", accessibleName = false, wrap = false, children }: HintProps) {
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
  const target = autoName === null ? children : cloneElement(children, { "aria-label": autoName });
  const trigger = wrap ? <span className="inline-flex">{target}</span> : target;

  return (
    <Tooltip disabled={empty}>
      <TooltipTrigger render={trigger} />
      {empty ? null : <TooltipContent side={side}>{label}</TooltipContent>}
    </Tooltip>
  );
}

export { Hint };
