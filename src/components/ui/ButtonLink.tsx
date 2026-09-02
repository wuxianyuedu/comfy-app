import Link from "next/link"
import { type VariantProps } from "class-variance-authority"

import { buttonVariants } from "~/components/ui/Button"
import { cn } from "~/lib/utils"

type ButtonLinkProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants>

/**
 * ButtonLink — 渲染为 next/link 的按钮（shadcn base-ui Button 无 asChild，
 * 故单独封装）。与 Button 共用 variant/size。
 */
export function ButtonLink({
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
  )
}
