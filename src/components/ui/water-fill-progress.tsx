"use client";

import { clampPct } from "~/lib/progress";

/* ─────────────────────────────────────────────────────────────────────────
 * "水逐渐装满" 进度覆盖层。
 *
 * 用法：放在任何 `relative` 容器的子节点里，绝对定位 `inset-0` 覆盖整个
 * 预览区。当 generation 期间（status === "running"）把进度传给 `progress`
 * 即可。`pointer-events-none` 确保不会拦截 FAB / 点击上传 / 拖入等交互。
 *
 * 视觉：
 *   - 深色水层从底向上涨，用 `translateY` 代替 `height` 动画（只触发合成层、
 *     不引发重排，§2.7），700ms 平滑过渡。
 *   - 水面是一条 6px 振幅的正弦波（SVG path），骑在水的上沿；
 *     CSS keyframe `wf-wave` 让波形水平无限滑动，营造"水面在动"的感觉。
 *   - 百分比用 tabular-nums 大字居中，白色 + 软阴影，永远在水面之上。
 *   - `rounded-xl overflow-hidden` 跟随 ContentAssetBody 的虚线/图片圆角
 *     （两者都是 `rounded-xl`），不会溢出成方角。
 *
 * 注意：透明值不要全 1——保留 ~0.9 让底层图片/虚线隐约可见，符合参考图的
 * "暗幕 + 隐约背景" 视觉（见截图 4 的 20% 节点预览）。
 * ───────────────────────────────────────────────────────────────────────── */
export function WaterFillProgress({
  progress,
  className = "",
}: {
  /** 0..100. 超出范围会被钳制。 */
  progress: number;
  className?: string;
}) {
  const pct = clampPct(progress);
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-xl ${className}`}
      aria-hidden
    >
      {/* 水层：用 translateY 代替 height 动画（只触发合成层、不引发重排），
       * 从底向上涨；progress 跳变时是滑动而不是闪烁。整层高度恒为 100%，
       * 下移到 (100-pct)% 处即只露出底部 pct，水面（顶部 SVG）恰好落在水位线，
       * 波形不被缩放扭曲。 */}
      <div
        className="absolute inset-x-0 top-0 transition-transform duration-700 ease-out"
        style={{
          height: "100%",
          transform: `translateY(${100 - pct}%)`,
          background:
            "linear-gradient(180deg, rgba(18,18,26,0.86) 0%, rgba(24,24,34,0.94) 60%, rgba(30,30,42,0.98) 100%)",
        }}
      >
        {/* 水面 SVG：10px 高，骑在水层 top-0 上沿（translateY(-5px) 让波形对称跨在
            边界上）。`wf-wave` class 触发 globals.css 里的 6s 线性水平滑动
            动画；由于 viewBox 宽 (120) = 渲染宽 (100%)，translateX -100% 恰好
            移动一整个波形周期，无缝循环。 */}
        <svg
          aria-hidden
          className="wf-wave absolute inset-x-0 top-0 w-full"
          style={{ height: "10px", transform: "translateY(-5px)" }}
          viewBox="0 0 120 10"
          preserveAspectRatio="none"
        >
          <path
            d="M0 5 Q 15 0, 30 5 T 60 5 T 90 5 T 120 5 V 10 H 0 Z"
            fill="rgba(24,24,34,0.94)"
          />
        </svg>
      </div>
      {/* 百分比：永远居中（在整张图之上，无论水位多高都可见）。 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[28px] leading-none font-semibold text-white tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}
