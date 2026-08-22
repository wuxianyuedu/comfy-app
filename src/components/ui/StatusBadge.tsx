import { cn } from "@/lib/utils";

/**
 * StatusBadge — 状态徽章。把业务状态字符串映射为统一的
 * 彩色标签，避免各处手写 if/else 配色不一致。
 *
 * 预置常见状态；未知状态回退为灰色。
 */
const STATUS_STYLES: Record<string, string> = {
  // 成功/完成
  SUCCEEDED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  ACTIVE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  PUBLISHED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  READY: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  // 进行中
  RUNNING: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  QUEUED: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  DRAFT: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  // 失败/异常
  FAILED: "bg-red-500/10 text-red-400 border-red-500/30",
  ERROR: "bg-red-500/10 text-red-400 border-red-500/30",
  BANNED: "bg-red-500/10 text-red-400 border-red-500/30",
  // 中性
  IDLE: "bg-white/[0.06] text-gray-400 border-white/10",
  DISABLED: "bg-white/[0.06] text-gray-400 border-white/10",
  INACTIVE: "bg-white/[0.06] text-gray-400 border-white/10",
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
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {label ?? status}
    </span>
  );
}
