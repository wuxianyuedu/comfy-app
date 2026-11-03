import { cn } from "~/lib/utils";

/**
 * 序号圆 —— 工坊五个界面里逐字相同的那一枚。不塞进 `ui/badge`：语义是「列表项序号」（等宽高、恒为短索引），徽标的 variant/tone 两轴不适用；住在 `workshop/`
 * 而非 `ui/` 是规范 §12.15 第三条（消费者全在工坊）。`grid place-items-center` 必需：契约「基元纪律 2」—— width/height 对 `display: inline` 不生效，
 * 缺了会画成约 4×20px 的竖线（原五处只是恰好落在 flex 容器里才成立）。
 */
export function IndexDot({
  index,
  size = "sm",
  className,
}: {
  className?: string;
  /** 圆里的内容：序号本身（调用点传 `i + 1` 或 `shot.index`）。 */
  index: number | string;
  /** `sm` = 24px（五处里的四处），`lg` = 28px（`FinalComposer` 那一处）。 */
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "bg-primary-soft text-primary grid shrink-0 place-items-center rounded-full text-xs font-semibold",
        size === "lg" ? "size-7" : "size-6",
        className,
      )}
    >
      {index}
    </span>
  );
}
