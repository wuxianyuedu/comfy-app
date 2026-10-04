import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * Badge 基座。
 *
 * 三轴独立：`variant`（6 档视觉基线）× `size`（default / sm / xs）
 * × `tone`（success / warning / danger / primary / neutral 语义色档）。
 *
 * 加 `size` 与 `tone` 的动机（§16.2.4.5 + P67 治理 PR-4）：项目内徽章家族
 * 有四个（`status-badge` / `list-badge` / `task-type-chip` / `source-tag`），
 * 此前 `ui/status-badge.tsx` 与 `ui/list-badge.tsx` 都是**手写 `<span>`
 * 胶囊 + 各自维护的 tone→class 映射表**（P67 判据 a 命中的锚点形态）。
 * 语义色映射表已经在 §4.11.1 整改里都改成了 token（不再是 `bg-emerald-*`
 * 字面量），但**基座仍是 `<span>`**——把两轴沉进 cva 之后，两处都能改成
 * `<Badge size="..." tone="...">` 薄封装；未来 `task-type-chip` /
 * `source-tag` 迁移到 `size="sm"` 也能顺手做（本 PR 只做治理清单里
 * 剩下的两个）。
 *
 * **向后兼容**：不传 `size` / `tone` 时，两轴在 cva 里都是 undefined
 * → 不加类，只吃 `variant` + base 的原视觉。已有的 `<Badge>` 消费点
 * 完全不受影响。
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /**
       * 尺寸轴（P67 治理 PR-4 新加）。
       *  · `default` = 通用胶囊（base 里的 h-5 / px-2 / py-0.5 / rounded-4xl /
       *    text-xs 全生效，这里不重复给）；
       *  · `sm` = 密集行内元信息档（与已治理的 task-type-chip / source-tag
       *    同档），h-auto + rounded-md + px-1.5 + py-0.5 + text-3xs；
       *  · `xs` = 极窄列表行内小徽标档（原 list-badge 的 text-[9px] + px-1 +
       *    py-px + rounded），leading-tight 让行高不撑破列表行基线。
       */
      size: {
        default: undefined,
        sm: "h-auto rounded-md px-1.5 py-0.5 text-3xs",
        xs: "h-auto gap-0 rounded px-1 py-px text-[9px] leading-tight",
      },
      /**
       * 语义色档（P67 治理 PR-4 新加，§4.11.1「映射表里的颜色也必须走语义
       * token」）。与 `ui/status-badge.tsx` / `ui/list-badge.tsx` 手抄映射表
       * 里的档位**同源**：bg-X/10 + text-X-strong（destructive 走 --destructive）
       * + border-X/30（`list-badge` 想要无边框时在调用点 `className="border-transparent"`
       * 顶掉）。不传 `tone` 时本轴完全不加类、由 `variant` 决定基线色。
       */
      tone: {
        success: "border-success/30 bg-success/10 text-success-strong",
        warning: "border-warning/30 bg-warning/10 text-warning-strong",
        danger: "border-destructive/30 bg-destructive/10 text-destructive",
        primary: "border-primary-500/30 bg-primary-500/10 text-primary-strong",
        neutral: "border-border-strong bg-subtle text-ink-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  size,
  tone,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size, tone }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
