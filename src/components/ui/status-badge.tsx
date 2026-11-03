import { Badge } from "~/components/ui/badge";

/** StatusBadge —— 状态徽章（Badge 基座 + 状态键 → tone 映射的薄封装，规范 16 §16.2.4.5；PR-4 起改为
 * `<Badge tone=...>` 二次封装）。`dot`（缺省）保留圆点，`dot={false}` 为纯文字胶囊（叠在缩略图上时节噪）。
 * P67（§16.2.3 / §12.18 / §4.11.1）：此前是手写 `<span>` + STATUS_STYLES，PR-4 把 `size` / `tone` 沉进 `ui/badge`
 * 的 cva，本件只留「业务状态 → 5 档语义 tone」这张业务判据。**颜色全部走语义 token**（规范 03 §3.6.2）：
 * 曾把 44 处 `emerald-*` / `violet-*` / `amber-*` / `red-*` 写死，改品牌色对它不生效；文案档由调用处给。 */
type StatusTone = "success" | "warning" | "danger" | "primary" | "neutral";

const STATUS_TONE: Record<string, StatusTone> = {
  // 成功/完成
  SUCCEEDED: "success",
  ACTIVE: "success",
  PUBLISHED: "success",
  READY: "success",
  DONE: "success",
  // 进行中（品牌色）
  RUNNING: "primary",
  // 待处理/过渡（警告色）
  QUEUED: "warning",
  PENDING: "warning",
  DRAFT: "warning",
  STARTING: "warning",
  // 失败/异常（走 shadcn 的 --destructive，与 Button 的 destructive 同源）
  FAILED: "danger",
  ERROR: "danger",
  BANNED: "danger",
  STALE: "danger",
  // 中性
  IDLE: "neutral",
  DISABLED: "neutral",
  INACTIVE: "neutral",
  LOCKED: "neutral",
};

export function StatusBadge({
  status,
  label,
  dot = true,
  className,
}: {
  className?: string;
  /** 是否渲染状态圆点（叠在媒体上的角标传 false） */
  dot?: boolean;
  /** 显示文案，缺省直接用 status */
  label?: string;
  status: string;
}) {
  const tone: StatusTone = STATUS_TONE[status.toUpperCase()] ?? "neutral";
  return (
    <Badge className={className} tone={tone}>
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />}
      {label ?? status}
    </Badge>
  );
}
