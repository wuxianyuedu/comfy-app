import { cn } from "~/lib/utils";

/**
 * StatusBadge — 状态徽章。把业务状态字符串映射为统一的
 * 彩色标签，避免各处手写 if/else 配色不一致。
 *
 * 预置常见状态；未知状态回退为灰色。
 *
 * **颜色全部走语义 token**（规范 03 §3.6.2）：这里曾把 44 处
 * `emerald-*` / `violet-*` / `amber-*` / `red-*` 写死，于是「把品牌色换成
 * 蓝色」对徽标不起作用 —— 徽标是全应用最显眼的状态指示，它不改，视觉体系
 * 立刻破功。改用 `--color-primary-*` / `--color-success*` / `--color-warning*`
 * / `--color-destructive` 后，改 token 即改全站。
 */
const STATUS_STYLES: Record<string, string> = {
  // 成功/完成（语义 token：--color-success / -strong 已两态取值）
  SUCCEEDED: "border-success/30 bg-success/10 text-success-strong",
  ACTIVE: "border-success/30 bg-success/10 text-success-strong",
  PUBLISHED: "border-success/30 bg-success/10 text-success-strong",
  READY: "border-success/30 bg-success/10 text-success-strong",
  // 进行中（品牌色：全部走 --color-primary-* 语义类名，改品牌色时这里跟着变）
  RUNNING: "border-primary-500/30 bg-primary-500/10 text-primary-strong",
  QUEUED: "border-warning/30 bg-warning/10 text-warning-strong",
  PENDING: "border-warning/30 bg-warning/10 text-warning-strong",
  DRAFT: "border-warning/30 bg-warning/10 text-warning-strong",
  // 失败/异常（走 shadcn 的 --destructive，与 Button 的 destructive 同源）
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  ERROR: "border-destructive/30 bg-destructive/10 text-destructive",
  BANNED: "border-destructive/30 bg-destructive/10 text-destructive",
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
