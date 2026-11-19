"use client";

import { useMemo } from "react";
import { Timer } from "lucide-react";

import { Dialog, DialogContent } from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { EMBEDDED_SCROLL_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { fixed } from "~/lib/number-format";
import {
  LAUNCH_SIDE_LABELS,
  launchSpanSide,
  type LaunchSpanSide,
  type LaunchTimings,
} from "~/lib/shell/launch-timings";

import { useLaunchTimings } from "./use-launch-timings";

/** 侧别 → 条/徽标配色（语义 token，两态自动跟随，规范 03 §3.6.2）：
 *  前端走信息蓝、后端走品牌紫——与启动页时间线同族，深浅两态都可分。 */
const SIDE_BAR_CLASS: Record<LaunchSpanSide, string> = {
  frontend: "bg-info",
  backend: "bg-primary",
};
const SIDE_BADGE_CLASS: Record<LaunchSpanSide, string> = {
  frontend: "bg-info/15 text-info-strong",
  backend: "bg-primary/15 text-primary-strong",
};

/** 甘特条的最小可见宽度（%）：0.1s 的微小段在 30s 的合计里不足 0.4%，
 *  不抬下限会细到看不见——「尽量全面」要求每一段都至少占一格视线。 */
const MIN_BAR_WIDTH_PCT = 0.5;

/** 时间线主体的单行（纯展示，§17.1：断言可直达 DOM）。 */
function TimingRow({
  label,
  running,
  side,
  startPct,
  title,
  valueText,
  widthPct,
}: {
  label: string;
  running: boolean;
  side: LaunchSpanSide;
  startPct: number;
  title: string;
  valueText: string;
  widthPct: number;
}) {
  return (
    <li className="flex items-center gap-2 text-xs" title={title}>
      <span
        className={`text-3xs w-10 shrink-0 rounded-sm px-1 py-px text-center leading-4 font-medium ${SIDE_BADGE_CLASS[side]}`}
      >
        {LAUNCH_SIDE_LABELS[side]}
      </span>
      <span className="text-ink-muted w-28 shrink-0 truncate">{label}</span>
      <span className="bg-surface-2 relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
        <span
          className={`absolute top-0 h-full rounded-full ${SIDE_BAR_CLASS[side]}`}
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
        />
      </span>
      <span className="text-ink-muted w-28 shrink-0 text-right tabular-nums">
        {valueText}
        {running ? "（进行中）" : ""}
      </span>
    </li>
  );
}

/** 侧别小计（并行段各自累计，因此两侧之和可能大于墙钟合计——文案里说明）。 */
function sideSum(timings: LaunchTimings, side: LaunchSpanSide): number {
  return timings.phases
    .filter((phase) => launchSpanSide(phase.key) === side)
    .reduce((acc, phase) => acc + phase.durationMs, 0);
}

/**
 * 启动耗时时间线面板（#4522）：启动耗时的**独立**查看入口，不再挤在日志面板里。
 *
 * 形态照启动页 #4504 的全量时间线升级：全部阶段按**开始顺序**铺成甘特式时间线
 * （左缘 = 该段起点占合计、宽 = 该段时长占合计），并行段（后台建表 vs 等待就绪）
 * 在轨道上直接可读；行首徽标区分**前端 / 后端**（首页编译是前端侧，其余是编排器
 * 与服务进程侧），图例给两侧小计。数据源与原日志卡同源（`/api/dev/launch-timings`
 * → `run/launch-status.json` 的 `timings`），无读数时给空态说明而不是空白。
 */
export function LaunchTimingsPanel({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const timings = useLaunchTimings(open);
  /* 时间线序：按起点升序铺开（接口侧已排，但视图不依赖传输顺序——打乱也能铺对）；
   * 轨道量程取墙钟合计（并行段不挤在一格）。 */
  const phases = useMemo(
    () => (timings ? [...timings.phases].sort((a, b) => a.startMs - b.startMs) : []),
    [timings],
  );
  const sums = useMemo(() => {
    if (!timings) {
      return null;
    }
    return {
      frontend: sideSum(timings, "frontend"),
      backend: sideSum(timings, "backend"),
    };
  }, [timings]);
  const scaleMs = timings && timings.totalMs > 0 ? timings.totalMs : 1;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-label="启动耗时时间线"
        className="gap-3"
        popupClassName="w-3xl max-w-[calc(100%-2rem)]"
      >
        <header className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-ink-strong text-sm font-semibold">启动耗时时间线</h2>
            <p className="text-ink-muted mt-0.5 text-xs">
              上一次启动各阶段的起止与耗时；条越靠右开始得越晚，并行段各自占一行。
            </p>
          </div>
          {timings ? (
            <span className="text-ink-muted shrink-0 text-xs tabular-nums">
              合计 {fixed(timings.totalMs / 1000, 1)}s
            </span>
          ) : null}
        </header>

        {timings && sums ? (
          <>
            {/* 图例：前后端两侧小计。并行段分别累计，两侧之和可能大于合计。 */}
            <div className="text-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="bg-info size-2 rounded-full" />
                前端 {fixed(sums.frontend / 1000, 1)}s
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="bg-primary size-2 rounded-full" />
                后端 {fixed(sums.backend / 1000, 1)}s
              </span>
              <span className="text-ink-fainter">并行段分别累计，两侧之和可能大于合计</span>
            </div>
            <ul
              className={`flex ${EMBEDDED_SCROLL_MAX_HEIGHT} flex-col gap-1.5 overflow-y-auto pr-1`}
            >
              {phases.map((phase) => {
                const running = phase.endMs === null;
                return (
                  <TimingRow
                    key={phase.key}
                    label={phase.label}
                    running={running}
                    side={launchSpanSide(phase.key)}
                    startPct={(phase.startMs / scaleMs) * 100}
                    title={`${phase.label} · 起点 ${fixed(phase.startMs / 1000, 1)}s · 时长 ${fixed(phase.durationMs / 1000, 1)}s`}
                    valueText={`${fixed(phase.durationMs / 1000, 1)}s · ${phase.percent}%`}
                    widthPct={Math.max((phase.durationMs / scaleMs) * 100, MIN_BAR_WIDTH_PCT)}
                  />
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState
            description="纯浏览器开发或启动读数尚未生成时没有数据；由桌面壳 / 编排器启动后这里会展示上一次启动的逐阶段耗时。"
            icon={Timer}
            title="暂无启动耗时读数"
            variant="panel"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
