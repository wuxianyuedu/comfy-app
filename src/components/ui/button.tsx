import Link from "next/link";
import { type ComponentProps } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        /* ── 语义色变体（ISSUE #672 / 规范 16 §16.2.4）──
           这四组是「软底（tinted）」形态：实心色在浅底上当按钮底会盖住层级
           关系，而视图里 400 处手写 `<button>` 的绝大多数正是软底徽标按钮
           （`bg-*-500/10 text-*-700 dark:text-*-300`）。变体名取**语义角色**
           不取色名：写 `variant="danger"` 而不是 `variant="red"`，换品牌色
           时调用处不用改（§3.6.2）。
           每一组的「文字档」都走 -strong token 而不是同一个色相的原色：
           同一个琥珀 `#d97706` 当底色可以、当浅底上的文字色对比度不足。 */
        primary:
          "bg-primary-500/15 text-primary-strong hover:bg-primary-500/25 focus-visible:border-primary-500/40 focus-visible:ring-primary-500/20",
        danger:
          "bg-destructive/10 text-danger-strong hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        success:
          "bg-success/10 text-success-strong hover:bg-success/20 focus-visible:border-success/40 focus-visible:ring-success/20",
        warning:
          "bg-warning/10 text-warning-strong hover:bg-warning/20 focus-visible:border-warning/40 focus-visible:ring-warning/20",
        info: "bg-info/10 text-info-strong hover:bg-info/20 focus-visible:border-info/40 focus-visible:ring-info/20",
        /* 实心档：视图里的「主行动按钮」还有一种 `bg-<色>-500/90 text-white`，
           它不属于上面的软底形态，故各出一支 -solid。P1 第一批只出了品牌 /
           危险 / 成功三色（当时实测只有这三色有实心用法）；设置页批次补出
           `warning-solid` —— 「继续等待视频生成」是实心琥珀（`bg-amber-500
           text-white`），它同时是「进行中」与「需要用户动手」两种语义的交叠，
           软底不足以表达。 */
        "primary-solid":
          "bg-primary-500 text-primary-foreground hover:bg-primary-600 focus-visible:border-primary-600 focus-visible:ring-primary-500/40",
        "danger-solid":
          "bg-destructive text-primary-foreground hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/30",
        "success-solid":
          "bg-success text-primary-foreground hover:bg-success/90 focus-visible:border-success focus-visible:ring-success/30",
        "warning-solid":
          "bg-warning-strong text-primary-foreground hover:bg-warning-strong/90 focus-visible:border-warning-strong focus-visible:ring-warning/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants>;

/**
 * ButtonLink — 渲染为 next/link 的按钮（shadcn base-ui Button 无 asChild，
 * 故单独封装）。与 Button 共用 variant/size。
 */
function ButtonLink({
  className,
  variant = "default",
  size = "default",
  href,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, ButtonLink, buttonVariants };
