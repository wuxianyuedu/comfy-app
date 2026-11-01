"use client";

import { cva, type VariantProps } from "class-variance-authority";

import { Button } from "~/components/ui/button";
import { splitDomProps, type OmitOwnProps } from "~/lib/dom-props";
import { cn } from "~/lib/utils";

/**
 * SelectChip —— 「一排里选一个」的 chip 按钮（**全库唯一实现**，
 * 规范 16 §16.2.4；ISSUE #1423）。
 *
 * ## 为什么必须收口：`Button variant="outline"` 会把选中态吃掉
 *
 * 收口前全库有 **20 处**这个形状的选中态是**逐字相同**的三元：
 *
 * ```tsx
 * <Button variant="outline" className={selected
 *   ? "border-primary text-primary bg-primary/10"   // ← 只写了"未选中之外"的那一半
 *   : "border-border text-muted-foreground hover:bg-subtle"}>
 * ```
 *
 * 它坏在一个**看不见的接缝**上：`outline` 变体自带
 * `hover:bg-muted hover:text-foreground`（见 `ui/button.tsx`）。选中分支**没有
 * 钉住悬停值** ⇒ 鼠标划到**已选中**的那一枚上时，`hover:` 胜出，字色翻成
 * `foreground`、底色翻成 `muted` —— 一枚紫色选中的 chip 悬停后变成白字灰底，
 * 看上去像"未选中"甚至像"另一个控件"。用户的原话是
 * 「按钮的选中状态悬浮和非悬浮一个紫色，一个白色」（ISSUE #1423）。
 *
 * 关键点是：**这个 bug 逐个调用点看不出来**。三元表达式读起来是完整的
 * （选中给一套、未选中给一套），缺的那一半在 `buttonVariants.outline`
 * 里。所以修法不是"把 20 处一起改"（§12.12 孪生对的修法是抽共享，不是两边
 * 一起改），而是让**选中态拥有自己的悬停值**，把这条决定收进一处。
 *
 * ## 选中态的三层，与 `ui/toggle-group` 同一条口径
 *
 * `ui/toggle-group` 在 P67 就补过同一件事（§16.8 台账）：官方版
 * `toggleVariants` 的悬停档与选中档都是 `bg-muted`，划过未选中项立刻长得像
 * 选中项。补的三层是 **描边 / 字重 / 抬层**，且都挂在选中档上、不与悬停撞。
 * 本件沿用同一套：
 *
 * | 层 | 选中档 | 未选中档 |
 * | --- | --- | --- |
 * | 底色 | `bg-primary-soft` | `bg-transparent`，悬停 `hover:bg-subtle` |
 * | 字色 | `text-primary-strong` | `text-muted-foreground`，悬停 `hover:text-ink` |
 * | 描边 | `border-primary/40` | `border-border` |
 * | 字重 | `font-semibold` | `font-normal` |
 *
 * 四层里任意一层失效，「选中」仍读得出来 —— 这是 §16.2.4.5「逐条定性」要求
 * 的「不是只差一个近乎同值的底色」（浅色主题下 `bg-subtle` 与行头底色
 * `surface-1` 同值 #f7f8fa 那件事，见 LogPanel 的 #609）。
 *
 * **描边取 `/40` 而不是饱和的 `border-primary`**：选中档已经是「深底 + 浅紫字
 * + 加粗」，再套一圈饱和紫环，读起来像**输入框被聚焦**而不是**这一档被选中**
 * （`dashed` 档的描边本来也是 `/40`，同一件里两档同值才成一套）。收 alpha 不
 * 掉那一层：未选中是中性发丝边 `border-border`，选中是带品牌色相的边，两者在
 * 两态主题下都判得出来。
 *
 * ## 选中档的悬停为什么必须写死
 *
 * **刻意把 `hover:` 钉回选中值**（`hover:bg-primary-soft`）而不是让它"自然
 * 叠加"。这不是为了好看，是为了让"已选中"这一事实**在悬停期间仍然成立** ——
 * 悬停是瞬时的、选中是持久的，持久状态不该被瞬时状态改写。`WorkshopStageItem`
 * 对 `aria-current` 的选中态早就这么写了（`hover:bg-primary/12` 与常态同值）。
 *
 * ## 语义：这是**单选**，不是 `aria-pressed`
 *
 * 一排 chip 里只有一个能选中（选模型 / 选模式），所以它的语义是
 * `role="radio"` + `aria-checked`，不是 `Toggle` 的 `aria-pressed`
 * （那是"这个开关开着吗"，可多项同时为真）。本件因此**不**复用
 * `ui/toggle` —— 两者语义不同，硬合会把多选契约塞进单选。
 *
 * `group` 那一层由调用处给（`role="radiogroup"` + `aria-label`）：一组
 * chip 的可访问名说的是**这一组在选什么**（"选择远端模型"），归调用处的
 * 文案，本件无从得知。
 */

const selectChipVariants = cva(
  /* 基类只放"两种状态都要"的东西：形状、过渡、焦点环、禁用档。
   * 尺寸与圆角走 `size` 轴 —— 一排 chip 用胶囊（`rounded-full`），
   * 分段控件里的用方角（`rounded-lg`），那是调用处的布局决定。 */
  "h-auto border font-medium tabular-nums transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      /* 轴名取 `shape` 不取 `variant`：`Button` 自己已有一个 `variant`
       * （default / outline / ghost …），同名轴会在透传时被覆盖 —— 这一族
       * 冲突是**编译期**的，`tsc` 当场报 TS2322，不会静默。 */
      shape: {
        /* 胶囊：一排筛选/选择 chip（模型清单、模式清单）。
         * 选中档的 `hover:*` 与常态同值 —— 见文件头「选中档的悬停为什么
         * 必须写死」。 */
        pill: "rounded-full px-3 py-1 text-xs border-border bg-transparent text-muted-foreground hover:bg-subtle hover:text-ink aria-checked:border-primary/40 aria-checked:bg-primary-soft aria-checked:font-semibold aria-checked:text-primary-strong aria-checked:hover:bg-primary-soft aria-checked:hover:text-primary-strong",
        /* 方角：分段控件 / 就近切换（工坊"本地 / API 直连"那一排）。 */
        segment:
          "rounded-lg px-3 py-1.5 text-sm border-border bg-transparent text-muted-foreground hover:bg-subtle hover:text-ink aria-checked:border-primary/40 aria-checked:bg-primary-soft aria-checked:font-semibold aria-checked:text-primary-strong aria-checked:hover:bg-primary-soft aria-checked:hover:text-primary-strong",
        /* 紧凑：编辑器里的次级 chip（模式分类下的小按钮、类型选择）。
         * 字号只到 `text-2xs`(11px) —— 这是**微标签两档的上限**，
         * 再往下就是 `text-3xs`(10px) 那档「角标 / 极小徽标」，
         * 不承担可读文案（DESIGN.md §Typography）。 */
        compact:
          "rounded px-2 py-0.5 text-2xs border-border bg-transparent text-muted-foreground hover:bg-subtle hover:text-ink aria-checked:border-primary/40 aria-checked:bg-primary-soft aria-checked:font-semibold aria-checked:text-primary-strong aria-checked:hover:bg-primary-soft aria-checked:hover:text-primary-strong",
        /* 虚线"添加"档：不是选中态，是同一排里的**动作**（＋ 添加模式 /
         * ＋ 添加输入映射）。它与选中档共用"品牌色描边 + 品牌色字"，
         * 但底色透明、描边虚线 —— 靠这两点与"已选中"区分开。 */
        dashed:
          "rounded border-dashed border-primary/40 bg-transparent text-primary hover:bg-primary/10",
      },
    },
    defaultVariants: {
      shape: "pill",
    },
  },
);

/** 本基元的私有键 —— 只写一遍，类型侧 `OmitOwnProps` 与运行时解构同吃这一份
 *（§16.2.4.61；`OmitOwnProps` 存在的理由就是让「剔了哪些」在类型上有个说法）。
 *
 * 只列**本件自己消费、不透传下去**的 `Button` 属性：
 *   · `selected` / `shape` 是本件新增的两轴，`Button` 不认识；
 *   · `variant` / `role` / `aria-checked` 由本件**写死**（`ghost` / `radio` /
 *     由 `selected` 派生）—— 调用处传了也会被覆盖，所以从类型上摘掉，
 *     免得写出「传了却不生效」的调用。
 *
 * **`className` / `type` 不在表里**：它们照常透传（`className` 还要与形态档
 * 经 `cn()` 合并 —— 这是调用处压过缺省档的唯一入口）。 */
const OWN_PROPS = /* SAFETY: 类型断言已复核 */ [
  "selected",
  "shape",
  "variant",
  "role",
  "aria-checked",
] as const;

export type SelectChipProps = OmitOwnProps<
  React.ComponentProps<typeof Button>,
  (typeof OWN_PROPS)[number]
> &
  VariantProps<typeof selectChipVariants> & {
    /** 这一枚是不是当前选中的那一枚。 */
    selected?: boolean;
  };

/**
 * 一枚可选的 chip。`selected` 决定选中态，并同时落到 `aria-checked` 上 ——
 * 视觉与可访问性由**同一个入参**驱动，调用处不可能只改一半。
 *
 * 一排由调用处包在 `role="radiogroup"` 里，并给整组 `aria-label`。
 */
export function SelectChip(rawProps: SelectChipProps) {
  /* 私有键与剩余字段按**同一份** `OWN_PROPS` 剥（§16.2.4.61）：
   * 表只写一遍，类型侧由 `OmitOwnProps` 吃它、运行时由 `splitDomProps` 吃它 ——
   * 两侧不可能漂移。`own` 里拿到的 `shape` / `selected` 未必有值（调用处没传就
   * 不凭空补），所以缺省档在下面这里落。 */
  const { own, rest } = splitDomProps(rawProps, OWN_PROPS);
  const selected = own.selected ?? false;
  const shape = own.shape ?? "pill";

  return (
    <Button
      {...rest}
      aria-checked={selected}
      className={cn(selectChipVariants({ shape, className: rest.className }))}
      role="radio"
      /* 这三件由本件**写死**：它们正是 `OWN_PROPS` 里被摘掉的那几项 ——
       * 调用处传了也不生效，所以从类型上就不给传（免得写出「传了却没反应」）。 */
      type={rest.type ?? "button"}
      variant="ghost"
    />
  );
}

export { selectChipVariants };
