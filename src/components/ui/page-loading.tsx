import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

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
 * 内联进按钮 / 一行文字时不要用本组件 —— 直接 import
 * `~/components/ui/spinner` 的 `Spinner`（它没有文案与布局），
 * 或传 `label=""` 并给 `flex-row`。
 *
 * 历史沿革：本件在 P67 治理 PR-2 期间曾薄 re-export 过 `Spinner`（当时的
 * 目的是「实现下沉到 shadcn 基元、消费点暂不动」）。后续一次性把
 * 15 处 `import { Spinner } from "~/components/ui/page-loading"` 全量迁到
 * `~/components/ui/spinner` 直连后，re-export 撤除、本件重新只管
 * `PageLoading` 一件事。
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
