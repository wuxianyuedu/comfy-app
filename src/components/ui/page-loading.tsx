import { cn } from "~/lib/utils";

/**
 * Spinner — 裸转圈（无文案），供「按钮内联加载态」等窄场景使用。
 *
 * 为什么必须有这一支：`PageLoading` 是**块级**加载态（居中 + 文案），
 * 而按钮里那点位置放不下它 —— 于是各调用点只能自己写
 * `<Loader2 className="animate-spin" />`，那正是规范 16 §16.2.3 的 P3 判据
 * 所计数的「自写 spinner」。把转圈这一件事收在这里后，`PageLoading` 也
 * 复用它，全库只有一处 `animate-spin`。
 *
 * 尺寸走 `sizeClass`（默认 `size-4`）；颜色默认继承 `currentColor`，
 * 所以放在深色底按钮里无需额外指定 —— 这也是它比 `PageLoading` 更适合
 * 内联的原因。
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      data-slot="spinner"
      aria-hidden
      className={cn(
        "border-primary-500/20 border-t-primary-500 size-4 shrink-0 animate-spin rounded-full border-2",
        className,
      )}
    />
  );
}

/**
 * 页面级通用加载态：居中 spinner + 文案，尺寸随父容器。
 *
 * spinner 颜色走 `--color-primary-500`（规范 03 §3.6.2）：此前写死
 * `border-violet-500`，改品牌色时这个全站可见的转圈仍是紫的。
 *
 * 全屏场景传 `h-screen w-screen`，页内场景传内容区高度
 * （如 `h-[calc(100vh-var(--toolbar-height,48px))]`）。
 *
 * 内联进按钮 / 一行文字时不要用本组件 —— 用 `Spinner`（它没有文案与布局），
 * 或传 `label=""` 并给 `flex-row`。
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
      <Spinner className="size-9" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
