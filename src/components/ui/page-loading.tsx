import { cn } from "~/lib/utils";

/**
 * 页面级通用加载态：居中 spinner + 文案，尺寸随父容器。
 *
 * spinner 颜色走 `--color-primary-500`（规范 03 §3.6.2）：此前写死
 * `border-violet-500`，改品牌色时这个全站可见的转圈仍是紫的。
 *
 * 全屏场景传 `h-screen w-screen`，页内场景传内容区高度
 * （如 `h-[calc(100vh-var(--toolbar-height,48px))]`）。
 */
export function PageLoading({
  className,
  label = "加载中…",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "text-ink-muted flex flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <span className="border-primary-500/20 border-t-primary-500 h-9 w-9 animate-spin rounded-full border-2" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
