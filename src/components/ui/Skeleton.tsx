import { cn } from "@/lib/utils";

/**
 * Skeleton — 骨架屏占位（加载态）。用法：
 *   <Skeleton className="h-4 w-32" />
 * 统一浅色呼吸动画，避免各页面各自实现 loading 闪烁。
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-white/[0.06]",
        className,
      )}
    />
  );
}

/** 列表型骨架屏：一行图标+两行文本，可指定行数。 */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
