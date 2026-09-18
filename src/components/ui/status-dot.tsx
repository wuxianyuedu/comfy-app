import { cn } from "~/lib/utils";

/**
 * StatusDot — 服务/进程状态圆点（**全库唯一实现**，规范 16 §16.2.4）。
 *
 * 为什么收口：设置页有三条同构的「状态行」（ComfyUI / Drizzle Studio /
 * Ollama），每行左侧都有一个彩色圆点表示「运行中 / 启动中 / 检测中 / 未运行」。
 * 三处各自写了一份四分支的三元套娃，配色还各写各的 Tailwind 色值 ——
 * 同一个「启动中」在三处分别是 `bg-amber-400`，改一处漏一片；而且写死的色值
 * 不受品牌/主题 token 控制（规范 03 §3.6.2）。
 *
 * 状态语义收在这里，颜色只走 token：
 *
 * | state | 颜色 | 语义 |
 * |-------|------|------|
 * | `up` | `bg-success` | 已就绪，可服务 |
 * | `busy` | `bg-warning` | 启动中 / 关闭中：过渡态，不要当成失败 |
 * | `probing` | `bg-info` | 状态探测中，结论未出 |
 * | `down` | `bg-destructive` | 明确未运行 |
 *
 * `pulse` 供「跟随中」这类**持续进行中**的指示复用（`animate-pulse`）——
 * 它此前也在三个文件里各写一份，同样收在这里（规范 16 §16.2.3 的 P3 判据）。
 */
export type StatusDotState = "up" | "busy" | "probing" | "down";

const STATE_CLASS: Record<StatusDotState, string> = {
  up: "bg-success",
  busy: "bg-warning",
  probing: "bg-info",
  down: "bg-destructive",
};

export function StatusDot({
  state,
  sizeClass = "size-2",
  pulse = false,
  className,
}: {
  /** 状态语义（见组件注释的对照表）。 */
  state: StatusDotState;
  /** 尺寸类，默认 `size-2`（状态行）；行内小点传 `size-1.5`。 */
  sizeClass?: string;
  /** 持续进行中（如日志「跟随中」）时加脉冲动画。 */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      data-slot="status-dot"
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full",
        sizeClass,
        STATE_CLASS[state],
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}
