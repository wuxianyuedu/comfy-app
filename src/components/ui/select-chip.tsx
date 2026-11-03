"use client";

import { cva, type VariantProps } from "class-variance-authority";

import { Button } from "~/components/ui/button";
import { splitDomProps, type OmitOwnProps } from "~/lib/dom-props";
import { cn } from "~/lib/utils";

/**
 * SelectChip —— 「一排里选一个」的 chip 按钮（全库唯一实现，规范 16 §16.2.4；ISSUE #1423）。收口前 20 处选中态是逐字相同的三元，但选中分支没钉住悬停值，`outline` 自带的 `hover:text-foreground` 会让已选中的紫色 chip 悬停后变白字灰底，看着像未选中。
 * 修法是让选中态拥有自己的悬停值（`hover:bg-primary-soft`），而不是逐个调用点改。四层差异（底色 / 字色 / 描边 `/40` / 字重）都挂在选中档、不与悬停撞；语义是单选 `role="radio"` + `aria-checked`，故不复用 `ui/toggle`；`group` 由调用处包 `role="radiogroup"`。
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

/** 本基元的私有键 —— 只写一遍，类型侧 `OmitOwnProps` 与运行时解构同吃（§16.2.4.61）。只列本件消费、
 *  不透传的 `Button` 属性：`selected` / `shape` 是本件新增，`variant` / `role` / `aria-checked` 由本件
 *  写死（传了也会被覆盖）。`className` / `type` 照常透传（`className` 还要与形态档 `cn()` 合并）。 */
/* SAFETY: 类型断言已复核 */
const OWN_PROPS = ["selected", "shape", "variant", "role", "aria-checked"] as const;

export type SelectChipProps = OmitOwnProps<
  React.ComponentProps<typeof Button>,
  (typeof OWN_PROPS)[number]
> &
  VariantProps<typeof selectChipVariants> & {
    /** 这一枚是不是当前选中的那一枚。 */
    selected?: boolean;
  };

/**
 * 一枚可选的 chip。`selected` 决定选中态并同时落到 `aria-checked` 上 —— 视觉与可访问性由同一个入参
 * 驱动，调用处不可能只改一半。一排由调用处包在 `role="radiogroup"` 里并给整组 `aria-label`。
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
