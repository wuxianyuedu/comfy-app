import { cn } from "~/lib/utils";

/**
 * ListBadge — 密集列表行的**内联小徽标**（规范 16 §16.2.4.5 的第三种形态）。
 *
 * 与另外两个状态基元的分工（判据是「它出现在哪里」，不是「长什么样」）：
 *
 * | 基元 | 形态 | 用在哪 |
 * |---|---|---|
 * | `ui/status-dot` | 一个圆点 | 状态行左侧 |
 * | `ui/status-badge` | 圆点 + 文字的胶囊（`text-xs` + 边框 + `px-2.5`） | 卡片头、详情头这类**独立徽标** |
 * | `ui/list-badge`（本件） | 纯文字的紧凑小块（`text-[9px]` + `px-1`，无边框） | 列表行里**紧跟标题**的元信息 |
 *
 * 为什么不能复用 `status-badge`：列表行高度是按「每行一行文字」定的，`text-xs`
 * 胶囊比行内文字还高，一行里塞几个就把行撑成两倍高 —— 工作流库列表曾因此
 * 每项挤进四枚 `text-[9px]` 手写徽标（`对外参数未配置`、`本地`、类型、模型），
 * 加上名称后总宽超过侧栏，被根容器的 `overflow-hidden` 裁掉（ISSUE #716）。
 * 收口到这里之后，**尺寸不再由每处各写一遍**：改一次全库列表同步。
 *
 * `tone` 的取色口径与 `status-badge` 同源（规范 03 §3.6.2）：语义色一律走
 * token，调用处不写 `bg-emerald-500/12` 这类字面量。
 */
export type ListBadgeTone =
  "neutral" | "success" | "warning" | "danger" | "primary";

const TONE_CLASS: Record<ListBadgeTone, string> = {
  neutral: "bg-subtle text-ink-faint",
  success: "bg-success/12 text-success-strong",
  warning: "bg-warning/12 text-warning-strong",
  danger: "bg-destructive/12 text-destructive",
  primary: "bg-primary-500/12 text-primary-strong",
};

export function ListBadge({
  children,
  tone = "neutral",
  title,
  className,
}: {
  children: React.ReactNode;
  /** 语义档；缺省中性（`bg-subtle` + `text-ink-faint`）。 */
  tone?: ListBadgeTone;
  /** 悬停说明。文案通常比徽标本身长得多（「未配置：提示词口未落到端口」），
   *  这正是把长文案收进 tooltip、只留短标记的原因。 */
  title?: string;
  className?: string;
}) {
  return (
    <span
      data-slot="list-badge"
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1 py-px text-[9px] leading-tight font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
