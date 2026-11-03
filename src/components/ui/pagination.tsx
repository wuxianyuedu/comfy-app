import * as React from "react";
import { cn } from "~/lib/utils";

import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      data-slot="pagination"
      role="navigation"
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex items-center gap-0.5", className)}
      data-slot="pagination-content"
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

/** 一页的链接（`<a href>`）。两个 `aria-label` 由 `PaginationPrevious` / `PaginationNext` 自己给（它们的内容是图标 + 折叠文案）。
 * ⚠️ `jsx-a11y/anchor-has-content` 看不穿 Base UI 的 `render` 通道：锚点的内容写在 `<Button>` 的 children 上、经 `render` 转发到 `<a>`，而规则只读这一处 JSX —— 它看到一个空 `<a />`。这是误报（渲染出来的锚点有真内容），处理办法是就地说明并把这条规则对该文件关掉：与 P84 `EXEMPT_FILES` 同口径（出口自身的实现不进收口面），判据侧由 `scripts/check-a11y-rules.cjs` 的白名单管着。 */
/* eslint-disable jsx-a11y/anchor-has-content -- 内容经 Base UI 的 render 通道转发，规则看不穿（见上） */
type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">;

function PaginationLink({ className, isActive, size = "icon", ...props }: PaginationLinkProps) {
  return (
    <Button
      className={cn(className)}
      nativeButton={false}
      render={
        <a
          aria-current={isActive === true ? "page" : undefined}
          data-active={isActive}
          data-slot="pagination-link"
          {...props}
        />
      }
      size={size}
      variant={isActive === true ? "outline" : "ghost"}
    />
  );
}
/* eslint-enable jsx-a11y/anchor-has-content */

function PaginationPrevious({
  className,
  text = "Previous",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      className={cn("pl-1.5!", className)}
      size="default"
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  );
}

function PaginationNext({
  className,
  text = "Next",
  ...props
}: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      className={cn("pr-1.5!", className)}
      size="default"
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
      <ChevronRightIcon data-icon="inline-end" />
    </PaginationLink>
  );
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      data-slot="pagination-ellipsis"
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More pages</span>
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
