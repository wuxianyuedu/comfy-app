import { cn } from "~/lib/utils";

/** StatusDot — 服务/进程状态圆点（**全库唯一实现**，规范 16 §16.2.4）。设置页三条同构状态行各写过一份四分支三元套娃，
 * 配色各写 Tailwind 色值 —— 同一个「启动中」三处不同、改一处漏一片，且不受 token 控制（规范 03 §3.6.2）。语义与颜色
 * 收在这里：`up`= `bg-success`（已就绪）、`busy`= `bg-warning`（启动/关闭中，过渡态不是失败）、`probing`= `bg-info`
 *（探测中）、`down`= `bg-destructive`（未运行）。`pulse` 供「跟随中」这类持续进行中的指示复用（P3 判据）。 */
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
  className?: string;
  /** 持续进行中（如日志「跟随中」）时加脉冲动画。 */
  pulse?: boolean;
  /** 尺寸类，默认 `size-2`（状态行）；行内小点传 `size-1.5`。 */
  sizeClass?: string;
  /** 状态语义（见组件注释的对照表）。 */
  state: StatusDotState;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full",
        sizeClass,
        STATE_CLASS[state],
        pulse && "animate-pulse",
        className,
      )}
      data-slot="status-dot"
    />
  );
}
