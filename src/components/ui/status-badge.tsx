import { cn } from "~/lib/utils";

/**
 * StatusBadge — 状态徽章。把业务状态字符串映射为统一的状态胶囊，
 * 避免各处手写 if/else 配色（规范 16 §16.2.4.5）。
 *
 * 两种形态：
 *   · `dot`（缺省）保留状态圆点 —— 画布节点头、结果卡、镜头卡等独立徽标；
 *   · `dot={false}` 纯文字胶囊 —— 叠在缩略图/媒体上的角标，图本身已经
 *     足够花，圆点只是噪声。
 *
 * **颜色全部走语义 token**（规范 03 §3.6.2）：这里曾把 44 处
 * `emerald-*` / `violet-*` / `amber-*` / `red-*` 写死，于是「把品牌色换成
 * 蓝色」对徽标不起作用 —— 徽标是全应用最显眼的状态指示，它不改，视觉体系
 * 立刻破功。改用 `--color-primary-*` / `--color-success*` / `--color-warning*`
 * / `--color-destructive` 后，改 token 即改全站。
 *
 * 文案档刻意**不由本文件提供**：业务里同一个状态在不同界面叫法不同
 *（任务历史「已完成」/ 画布节点「运行后生成」/ 镜头「片段就绪」），
 * 那属于业务文案、不是样式。调用处用自己的标签表，配色走本文件。
 */
const STATUS_STYLES: Record<string, string> = {
  // 成功/完成（语义 token：--color-success / -strong 已两态取值）
  SUCCEEDED: "border-success/30 bg-success/10 text-success-strong",
  ACTIVE: "border-success/30 bg-success/10 text-success-strong",
  PUBLISHED: "border-success/30 bg-success/10 text-success-strong",
  READY: "border-success/30 bg-success/10 text-success-strong",
  DONE: "border-success/30 bg-success/10 text-success-strong",
  // 进行中（品牌色：全部走 --color-primary-* 语义类名，改品牌色时这里跟着变）
  RUNNING: "border-primary-500/30 bg-primary-500/10 text-primary-strong",
  QUEUED: "border-warning/30 bg-warning/10 text-warning-strong",
  PENDING: "border-warning/30 bg-warning/10 text-warning-strong",
  DRAFT: "border-warning/30 bg-warning/10 text-warning-strong",
  STARTING: "border-warning/30 bg-warning/10 text-warning-strong",
  // 失败/异常（走 shadcn 的 --destructive，与 Button 的 destructive 同源）
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  ERROR: "border-destructive/30 bg-destructive/10 text-destructive",
  BANNED: "border-destructive/30 bg-destructive/10 text-destructive",
  STALE: "border-destructive/30 bg-destructive/10 text-destructive",
  // 中性
  IDLE: "border-border-strong bg-subtle text-ink-muted",
  DISABLED: "border-border-strong bg-subtle text-ink-muted",
  INACTIVE: "border-border-strong bg-subtle text-ink-muted",
  LOCKED: "border-border-strong bg-subtle text-ink-muted",
};

export function StatusBadge({
  status,
  label,
  dot = true,
  className,
}: {
  status: string;
  /** 显示文案，缺省直接用 status */
  label?: string;
  /** 是否渲染状态圆点（叠在媒体上的角标传 false） */
  dot?: boolean;
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
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
          aria-hidden
        />
      )}
      {label ?? status}
    </span>
  );
}
