import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/** Badge 基座：`variant`（6 档视觉基线）× `size`（default / sm / xs）× `tone`（success / warning / danger / primary / neutral）三轴独立。
 * 加 size/tone 的动机（§16.2.4.5 + P67 PR-4）：徽章家族四个组件此前各自手写 `<span>` 胶囊 + tone→class 映射表，沉进 cva 后可改成 `<Badge size tone>` 薄封装。
 * 向后兼容：不传 size/tone 时两轴在 cva 里为 undefined → 不加类，只吃 `variant` + base 原视觉。 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /** 尺寸轴（P67 PR-4）：`default` = 通用胶囊（base 的 h-5 / px-2 / py-0.5 / rounded-4xl / text-xs 全生效，这里不重复给）；
       * `sm` = 密集行内元信息档（h-auto + rounded-md + px-1.5 + py-0.5 + text-3xs）；`xs` = 极窄列表小徽标（px-1 + py-px + text-4xs + leading-tight，行高不撑破列表基线）。 */
      size: {
        default: undefined,
        sm: "h-auto rounded-md px-1.5 py-0.5 text-3xs",
        xs: "h-auto gap-0 rounded px-1 py-px text-4xs leading-tight",
        /* 胶囊形小两档：从调用点量出来的既有形状（12 处手抄，px 1.5/2/2.5、字号 2xs/3xs 各不同），只收小高度与字号、不换圆角；要方圆角用 `sm` / `xs`。
         **`border-0` 是必需的，不是美化**：base 带 `border border-transparent`，透明边框照样占布局（实测同串字留 1px 高 21px、`border-0` 高 19px）；tone 只给边框色不给宽度，不会被顶回来。 */
        "pill-sm": "h-auto rounded-full border-0 px-1.5 py-0.5 text-3xs",
        "pill-md": "h-auto rounded-full border-0 px-2 py-0.5 text-2xs",
      },
      /** 语义色档（P67 PR-4，§4.11.1）：与 status-badge / list-badge 手抄映射表同源 —— bg-X/10 + text-X-strong（destructive 走 --destructive）+ border-X/30。
       * `list-badge` 要无边框时在调用点用 `className="border-transparent"` 顶掉；不传 `tone` 时本轴不加类，由 `variant` 决定基线色。 */
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
