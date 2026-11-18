"use client";

import { ProgressBar } from "~/components/ui/progress-bar";
import { toPct } from "~/lib/progress";
import { fixed } from "~/lib/number-format";

import { useLaunchTimings } from "./use-launch-timings";

/**
 * 启动耗时分解卡（#4327）：启动页的耗时彩条随窗口交接一起消失，这里把同一份
 * 读数（`run/launch-status.json` 的 `timings`）搬进应用内日志面板，并把密集的
 * 彩色细条换成**逐行**的「阶段名 + 比例条 + 秒数/占比」——每一段是什么、花了
 * 多久，一行一眼。无读数（纯浏览器开发 / 文件还没写）整卡不显示。
 *
 * 条的形态走 `ui/progress-bar` 的 `ProgressBar`、数值走 `~/lib/progress` 的
 * `toPct`（规范 16 §16.2.4.19 的两个唯一出口）：条宽按「该阶段 / 最长阶段」画
 * （最长的一段占满轨道，其余按比例缩短），文字给的是「占总启动时间的百分比」
 * ——比较用条、精确值用文字，两个口径各司其职。
 */
export function LaunchTimingsCard() {
  const timings = useLaunchTimings(true);
  if (!timings) {
    return null;
  }
  const maxMs = Math.max(...timings.phases.map((p) => p.durationMs), 1);
  return (
    <section
      aria-label="启动耗时分解"
      className="border-border-strong bg-panel mx-3 mt-2 shrink-0 rounded-xl border p-3"
    >
      <header className="text-ink-muted mb-2 flex items-baseline justify-between text-xs">
        <span className="text-ink-bright font-medium">启动耗时分解</span>
        <span className="tabular-nums">合计 {fixed(timings.totalMs / 1000, 1)}s</span>
      </header>
      <ul className="flex flex-col gap-1.5">
        {timings.phases.map((phase) => (
          <li className="flex items-center gap-2 text-xs" key={phase.key}>
            <span className="text-ink-muted w-28 shrink-0 truncate">{phase.label}</span>
            <ProgressBar
              ariaLabel={`${phase.label} 耗时占比`}
              className="min-w-0 flex-1"
              minVisible={2}
              showValue={false}
              trackClassName="h-1.5"
              value={toPct(phase.durationMs, maxMs)}
            />
            <span className="text-ink-muted w-28 shrink-0 text-right tabular-nums">
              {fixed(phase.durationMs / 1000, 1)}s · {phase.percent}%
              {phase.endMs === null ? "（进行中）" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
