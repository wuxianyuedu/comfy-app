"use client";

import { useEffect, useState } from "react";

/**
 * FpsMeter — 画布帧率指示器（2026-08-29）
 *
 * 大工作流（130+ 节点）在拖拽 / 平移 / 缩放时偶尔会掉帧，而界面上没有任何
 * 「还活着」的信号，用户分不清是**卡顿**还是**程序死了**。这里用
 * requestAnimationFrame 统计真实帧率，每 500ms 刷新一次读数（不是每帧 setState，
 * 否则指示器自己就成了掉帧来源）。
 *
 * 读数语义：浏览器 rAF 的上限是屏幕刷新率（60Hz → 最高 60），所以
 *   - ≥50  流畅（绿）
 *   - 30~49 轻微掉帧（黄）
 *   - <30  明显卡顿（红）
 * 页面在后台标签时 rAF 会被暂停，恢复后第一帧会算出很低的瞬时值，
 * 因此首帧不计入（见 effect 内的 `primed`）。
 */
export function FpsMeter({ className = "" }: { className?: string }) {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let frames = 0;
    /* 首帧间隔不可信（挂载开销 / 后台标签恢复），先跑一帧再开始计时。 */
    let primed = false;
    let last = 0;

    const tick = (now: number) => {
      if (stopped) return;
      if (!primed) {
        primed = true;
        last = now;
        frames = 0;
        raf = requestAnimationFrame(tick);
        return;
      }
      frames += 1;
      const elapsed = now - last;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const tone =
    fps === null
      ? "text-gray-400"
      : fps >= 50
        ? "text-emerald-300"
        : fps >= 30
          ? "text-amber-300"
          : "text-rose-300";

  const dot =
    fps === null
      ? "bg-gray-500"
      : fps >= 50
        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
        : fps >= 30
          ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
          : "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.8)]";

  return (
    <div
      className={`pointer-events-none absolute z-6 select-none rounded-md border border-white/10 bg-(--color-panel)/90 px-2.5 py-1 text-[11px] font-medium tabular-nums tracking-tight text-gray-300 shadow-lg backdrop-blur-sm ${className}`}
      title="画布实时帧率：看数值就能判断是卡顿还是卡死（60 = 满帧，<30 明显卡顿）"
      aria-live="off"
    >
      <span aria-hidden className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${dot}`} />
      <span className={tone}>{fps ?? "—"}</span>
      <span className="ml-1 text-gray-400">FPS</span>
    </div>
  );
}
