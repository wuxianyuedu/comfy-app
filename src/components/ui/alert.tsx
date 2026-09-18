import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
        /* ── 语义色变体（ISSUE #672 / 规范 16 §16.2.4）──
           与 `ui/button` 的软底变体同源：`warning` / `info` / `success` /
           `danger` 接管「边框 + 底色 + 文字档」三件事，文字一律走 -strong
           token（同一色相的原色当浅底上的文字对比度不足）。变体名取语义
           角色不取色名，换品牌色时调用处不用改（§3.6.2）。 */
        warning:
          "border-warning/30 bg-warning/10 text-warning-strong *:data-[slot=alert-description]:text-warning-strong/90 *:[svg]:text-current",
        info: "border-info/30 bg-info/10 text-info-strong *:data-[slot=alert-description]:text-info-strong/90 *:[svg]:text-current",
        success:
          "border-success/30 bg-success/10 text-success-strong *:data-[slot=alert-description]:text-success-strong/90 *:[svg]:text-current",
        danger:
          "border-destructive/30 bg-destructive/10 text-danger-strong *:data-[slot=alert-description]:text-danger-strong/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "[&_a]:hover:text-foreground font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground [&_a]:hover:text-foreground text-sm text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
