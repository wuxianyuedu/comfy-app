import { cn } from "~/lib/utils";

/**
 * StatusBadge — 状态徽章。把业务状态字符串映射为统一的
 * 彩色标签，避免各处手写 if/else 配色不一致。
 *
 * 预置常见状态；未知状态回退为灰色。
 */
const STATUS_STYLES: Record<string, string> = {
  // 成功/完成
  SUCCEEDED:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ACTIVE:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PUBLISHED:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  READY:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  // 进行中
  RUNNING:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  QUEUED:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PENDING:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DRAFT:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  // 失败/异常
  FAILED: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  ERROR: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  BANNED: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  // 中性
  IDLE: "border-border-strong bg-subtle text-ink-muted",
  DISABLED: "border-border-strong bg-subtle text-ink-muted",
  INACTIVE: "border-border-strong bg-subtle text-ink-muted",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  /** 显示文案，缺省直接用 status */
  label?: string;
  className?: string;
}) {
  const style = STATUS_STYLES[status.toUpperCase()] ?? STATUS_STYLES.IDLE;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        style,
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
        aria-hidden
      />
      {label ?? status}
    </span>
  );
}
