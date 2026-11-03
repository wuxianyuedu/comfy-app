import { Badge } from "~/components/ui/badge";

/**
 * ListBadge —— 密集列表行的内联小徽标（规范 16 §16.2.4.5 第三种形态；PR-4 起为 `<Badge size="xs">` 薄封装）。与 status-dot / status-badge 的分工按「出现在哪里」：本件是纯文字紧凑块（`text-4xs` + `px-1`，无边框），紧跟列表行标题。
 * 不能复用 `status-badge`：`text-xs` 胶囊比行内文字还高，曾把工作流库列表撑成两倍高并被 `overflow-hidden` 裁掉（ISSUE #716）。无边框靠 `className="border-transparent"` 顶掉 tone 边框；`tone` 取色与 status-badge 同源（Badge cva），语义色走 token（规范 03 §3.6.2）。
 */
export type ListBadgeTone = "neutral" | "success" | "warning" | "danger" | "primary";

export function ListBadge({
  children,
  tone = "neutral",
  title,
  className,
}: {
  children: React.ReactNode;
  className?: string;
  /** 悬停说明。文案通常比徽标本身长得多（「未配置：提示词口未落到端口」），
   *  这正是把长文案收进 tooltip、只留短标记的原因。 */
  title?: string;
  /** 语义档；缺省中性（`bg-subtle` + `text-ink-faint`）。 */
  tone?: ListBadgeTone;
}) {
  return (
    <Badge
      /* list-badge 视觉契约：**无边框**。Badge cva 的 tone 会带
       * border-X/30，这里用 border-transparent 顶掉（tailwind-merge
       * 后传者胜）；px-1 / py-px / text-4xs / rounded 由 size=xs 给。 */
      className={`border-transparent ${className ?? ""}`}
      size="xs"
      title={title}
      tone={tone}
    >
      {children}
    </Badge>
  );
}
