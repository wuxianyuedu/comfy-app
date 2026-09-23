import { Spinner as ShadcnSpinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

/**
 * Spinner —— 裸转圈（无文案），供「按钮内联加载态」等窄场景使用。
 *
 * 本件是 `~/components/ui/spinner` 的薄 re-export（P67 治理 PR-2 · §12.18
 * 复用优先）：此前这里是全库 spinner 的**唯一实现**（规范 16 §16.2.3 P3
 * 判据所计数的「自写 spinner」出口），自己画 `<span class="border-2
 * animate-spin rounded-full">`。补齐官方 shadcn Spinner 基元后
 * （`pnpm dlx shadcn@latest add spinner`），把「转圈」这件事交给基元
 * ——Loader2Icon + `animate-spin` 的语义、a11y（`role="status"` /
 * `aria-label="Loading"`）都在基元里，调用处 `className="size-*"` 控
 * 尺寸即可（shadcn Spinner 是 `<svg>` 元素、天然块级，此前 `inline-block`
 * 那条 ISSUE #720 的坑不再适用）。
 *
 * re-export 保留 `Spinner` 命名是为了**不打破** `confirm-dialog.tsx` 等
 * 既有 `import { Spinner } from "~/components/ui/page-loading"` 的消费点
 * （改点遍布多处、留作后续 PR 逐条换到 `ui/spinner` 直连；本 PR 只把
 * 「实现」下沉到基元，「出口位置」暂不动）。
 */
export const Spinner = ShadcnSpinner;

/**
 * 页面级通用加载态：居中 spinner + 文案，尺寸随父容器。
 *
 * spinner 颜色走 `--color-primary-500`（规范 03 §3.6.2）：此前 `page-loading`
 * 的自绘 `<span class="border-violet-500">` 写死过品牌色，改主题跟不动。
 * 换成 shadcn `Spinner` 之后色随 `currentColor`，由父级 `text-primary` /
 * `text-ink-muted` 决定 —— 本件里给 `<Spinner className="size-9 text-primary" />`
 * 显式定色。
 *
 * 全屏场景传 `h-screen w-screen`，页内场景传内容区高度
 * （如 `h-[calc(100vh-var(--toolbar-height,48px))]`）。
 *
 * 内联进按钮 / 一行文字时不要用本组件 —— 直接用 `Spinner`（它没有文案与
 * 布局），或传 `label=""` 并给 `flex-row`。
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
      <Spinner className="text-primary size-9" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
