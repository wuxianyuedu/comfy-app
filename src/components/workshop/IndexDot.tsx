import { cn } from "~/lib/utils";

/**
 * 序号圆 —— 工坊五个界面里逐字相同的那一枚（`CharacterDesigner` / `FinalComposer` /
 * `ShotStudio` / `StoryboardPlanner.parts` / `VideoStudio.parts`）。
 *
 * 为什么单独有它、而不是塞进 `ui/badge`：形状语义不同 —— 徽标是「一个可变文字的标签」，
 * 这里是「列表项的序号」，宽高相等、内容恒为一个数字或短索引。塞进 Badge 会让
 * `variant` / `tone` 两轴多出一支根本不适用的组合（等宽高 + 居中 + 无描边）。
 *
 * 为什么住在 `workshop/` 而不是 `ui/`：五个消费者全在工坊里，目前看不出第二个域的
 * 调用点（规范 §12.15 第三条：看不出第二个用的先就地写）。真要被别处用再提升到 `ui/`。
 *
 * `grid place-items-center` 是必需的，不是随手写的居中方案：契约 §Components
 * 「基元纪律 2」——`width`/`height` 对 `display: inline` 不生效，`<span className="size-6">`
 * 画出来是一条约 4×20px 的竖线。原来五处都恰好落在 flex 容器里才「碰巧」成立。
 */
export function IndexDot({
  index,
  size = "sm",
  className,
}: {
  /** 圆里的内容：序号本身（调用点传 `i + 1` 或 `shot.index`）。 */
  index: number | string;
  /** `sm` = 24px（五处里的四处），`lg` = 28px（`FinalComposer` 那一处）。 */
  size?: "sm" | "lg";
  className?: string;
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
