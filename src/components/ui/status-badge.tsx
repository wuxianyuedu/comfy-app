import { Badge } from "~/components/ui/badge";

/**
 * StatusBadge —— 状态徽章（**Badge 基座 + 状态键 → tone 映射**的薄封装，
 * 规范 16 §16.2.4.5；本次 PR-4 起改为 `<Badge tone=...>` 二次封装）。
 *
 * 两种形态：
 *   · `dot`（缺省）保留状态圆点 —— 画布节点头、结果卡、镜头卡等独立徽标；
 *   · `dot={false}` 纯文字胶囊 —— 叠在缩略图/媒体上的角标，图本身已经
 *     足够花，圆点只是噪声。
 *
 * ## P67 治理（§16.2.3 / §12.18 / §4.11.1）
 *
 * 此前本件是**手写 `<span>` 胶囊 + 一份 STATUS_STYLES 常量表**——正是
 * P67 判据 a 的锚点形态。语义色 token 化在 §4.11.1 的 ISSUE #672 整改里
 * 已经完成（不再写死 `emerald-*` / `violet-*`），但基座仍是 `<span>`。
 * PR-4 把 `size` 与 `tone` 两轴沉进 `~/components/ui/badge` 的 cva 之后，
 * 本件只需保留「业务状态字符串 → 5 档语义 tone」这一张映射表（这才是
 * 真正的**业务判据**，与样式无关），其余交给基元。
 *
 * **颜色全部走语义 token**（规范 03 §3.6.2）：这里曾把 44 处 `emerald-*`
 * / `violet-*` / `amber-*` / `red-*` 写死，于是「把品牌色换成蓝色」对
 * 徽标不起作用——徽标是全应用最显眼的状态指示，它不改，视觉体系立刻破功。
 * 现在 tone 一列全部取自 `~/components/ui/badge` 里的 cva.tone（`--color-success`
 * / `--color-warning` / `--color-destructive` / `--color-primary-*`），
 * 改 token 即改全站。
 *
 * 文案档刻意**不由本文件提供**：业务里同一个状态在不同界面叫法不同
 * （任务历史「已完成」/ 画布节点「运行后生成」/ 镜头「片段就绪」），
 * 那属于业务文案、不是样式。调用处用自己的标签表，配色走本件。
 */
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
  status: string;
  /** 显示文案，缺省直接用 status */
  label?: string;
  /** 是否渲染状态圆点（叠在媒体上的角标传 false） */
  dot?: boolean;
  className?: string;
}) {
  const tone: StatusTone = STATUS_TONE[status.toUpperCase()] ?? "neutral";
  return (
    <Badge tone={tone} className={className}>
      {dot && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-current opacity-80"
          aria-hidden
        />
      )}
      {label ?? status}
    </Badge>
  );
}
