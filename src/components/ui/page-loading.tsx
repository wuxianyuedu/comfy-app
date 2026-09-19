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
 *
 * ── 为什么自带 `inline-block`（ISSUE #720）──────────────────────────
 * `<span>` 默认是 `display: inline`，而 `width` / `height` 对行内盒
 * **不生效**。此前它唯一的落点都在 flex 容器里（`flex` 会把子项的 display
 * 计算值块化），尺寸照常生效 —— 于是这个前提一直没被写下来，也没人发现它
 * 依赖调用处的布局。
 *
 * 而 `EmptyState` 的图标位正是非 flex 的：`<span class="block">` 里塞一个
 * 行内 span，`size-6` 被完全忽略 —— 画出来的是「同色的 2px 上下边框叠在
 * 一个行内盒上」，也就是一条 **约 4px 宽、20px 高的竖线**：用户看不出那是
 * 加载指示器，只读到一个来源不明的图案。
 *
 * 所以尺寸的成立不再外包给调用处的 display：转圈自带 `inline-block`
 * （`shrink-0` 同时保住它在 flex 行里不被压扁）。按钮内联态不受影响 ——
 * 它在 flex 容器里照样块化。
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      data-slot="spinner"
      aria-hidden
      className={cn(
        "border-primary-500/20 border-t-primary-500 inline-block size-4 shrink-0 animate-spin rounded-full border-2",
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
