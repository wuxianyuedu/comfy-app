import { cn } from "@/lib/utils";

/**
 * EmptyState — 空状态占位。统一"无数据"视觉，替代散落的
 * "暂无数据"文字，支持自定义图标与操作按钮。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border bg-surface/50 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div className="bg-primary-soft text-primary flex h-12 w-12 items-center justify-center rounded-xl">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-ink text-sm font-semibold">{title}</p>
        {description && (
          <p className="text-muted-foreground mx-auto max-w-sm text-[13px] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
