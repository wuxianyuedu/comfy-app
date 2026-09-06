"use client";

// ── 全局帧率读数（第②层逻辑）──────────────────────────────────────────
// 用 requestAnimationFrame 统计真实帧率，每 500ms 刷新一次（不是每帧
// setState，否则指示器自己就成了掉帧来源）。画布大图拖拽 / 缩放掉帧时，
// 给用户一个「还活着」的信号。语义见原 FpsMeter：≥50 流畅，30~49 轻微
// 掉帧，<30 明显卡顿。页面在后台时 rAF 被暂停，恢复后首帧不计入。

import { useEffect, useState } from "react";

export type FpsTone = "ok" | "warn" | "bad" | "unknown";

export function fpsTone(fps: number | null): FpsTone {
  if (fps === null) return "unknown";
  if (fps >= 50) return "ok";
  if (fps >= 30) return "warn";
  return "bad";
}

export function useFps(): number | null {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let frames = 0;
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

  return fps;
}
