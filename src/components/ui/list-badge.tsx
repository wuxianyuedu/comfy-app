import { Badge } from "~/components/ui/badge";

/**
 * ListBadge —— 密集列表行的**内联小徽标**（规范 16 §16.2.4.5 的第三种
 * 形态；本次 PR-4 起改为 `<Badge size="xs" tone=...>` 薄封装）。
 *
 * 与另外两个状态基元的分工（判据是「它出现在哪里」，不是「长什么样」）：
 *
 * | 基元 | 形态 | 用在哪 |
 * |---|---|---|
 * | `ui/status-dot` | 一个圆点 | 状态行左侧 |
 * | `ui/status-badge` | 圆点 + 文字的胶囊（`text-xs` + 边框 + `px-2.5`） | 卡片头、详情头这类**独立徽标** |
 * | `ui/list-badge`（本件） | 纯文字的紧凑小块（`text-[9px]` + `px-1`，无边框） | 列表行里**紧跟标题**的元信息 |
 *
 * 为什么不能复用 `status-badge`：列表行高度是按「每行一行文字」定的，
 * `text-xs` 胶囊比行内文字还高，一行里塞几个就把行撑成两倍高——工作流库
 * 列表曾因此每项挤进四枚 `text-[9px]` 手写徽标（`对外参数未配置`、`本地`、
 * 类型、模型），加上名称后总宽超过侧栏，被根容器的 `overflow-hidden` 裁掉
 * （ISSUE #716）。收口到这里之后，**尺寸不再由每处各写一遍**：改一次
 * 全库列表同步。
 *
 * ## P67 治理（§16.2.3 / §12.18 / §4.11.1）
 *
 * 此前本件是**手写 `<span>` + 一份 TONE_CLASS 常量表**（P67 判据 a 命中
 * 的锚点形态）。PR-4 把 `size=xs` 与 `tone` 两轴沉进 `~/components/ui/badge`
 * 的 cva 之后，本件只剩「`tone` prop → Badge 的 `tone` prop」这一层
 * 极薄的直通映射（`danger` 是 list-badge 对外 API 的历史命名，映射到
 * Badge 里的 `danger` tone；其余同名）。
 *
 * `list-badge` 的**无边框视觉**通过 `className="border-transparent"`
 * 顶掉 Badge tone 的 `border-X/30`（tailwind-merge 后传者胜）。之所以
 * 不给 Badge 再加一条 `bordered` 轴：那会是「只有一处用到」的过度泛化
 * （§12.15「只有 1 个又看不出第二个的，先就地写、别急着抽象」）。
 *
 * `tone` 的取色口径与 `status-badge` 完全同源（都吃 Badge cva.tone）：
 * 语义色一律走 token（规范 03 §3.6.2），调用处不写 `bg-emerald-500/12`
 * 这类字面量。
 */
export type ListBadgeTone =
  "neutral" | "success" | "warning" | "danger" | "primary";

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
    <Badge
      size="xs"
      tone={tone}
      title={title}
      /* list-badge 视觉契约：**无边框**。Badge cva 的 tone 会带
       * border-X/30，这里用 border-transparent 顶掉（tailwind-merge
       * 后传者胜）；px-1 / py-px / text-[9px] / rounded 由 size=xs 给。 */
      className={`border-transparent ${className ?? ""}`}
    >
      {children}
    </Badge>
  );
}
