"use client";

import { ButtonLink } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { ProgressBar } from "~/components/ui/progress-bar";
import { Separator } from "~/components/ui/separator";
import { StatusBadge } from "~/components/ui/status-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { displayValue } from "~/lib/display-value";
import { fmtBytes } from "~/lib/format-bytes";
import { cn } from "~/lib/utils";
import {
  STALE_RESOURCE_NOTE,
  WAIT_FIRST_SAMPLE_NOTE,
  selectVisibleResourceMetrics,
} from "./comfy-resource-metrics";
import { useComfyReadiness } from "./hooks/use-comfy-readiness";

/**
 * 首页「本机算力」总览卡。
 *
 * 为什么在首页放一份、而不是让人滚到底部状态栏去看：状态栏那一格是**结果**（三个百分比
 * 数字），用户在决定「现在能不能开跑一条镜头」时问的是**原因** —— 后端在不在线、显存还
 * 够不够、读不到的是「没启动」还是「暂时读不到」。这三种情形的处置完全不同，卡片把它们
 * 分开说（徽标 + 状态行 + 一句可见的降级说明），而不是混成一个百分比。
 *
 * 数据来源**只有** `useComfyReadiness()`：它已经把 ComfyUI `/system_stats` 的轮询收在
 * `src/lib/comfy/comfy-stats-store.ts` 这一个持有者里（首页挂这份不会多一路轮询，与状态栏
 * 共用同一条）。视图层这里零 IO（规范 §17）。
 *
 * 刻意没搬原型里的两块：
 *   · **队列 / 历史计数** —— `useComfyQueue` 目前还是「每实例各一份 useState + useInterval」，
 *     在首页再挂一处就是同一个端点两路轮询，正是状态指标那一刀刚消掉的形状。先给队列补
 *     同样的单点持有者，再谈把它放上首页。
 *   · **Ollama 与显存不足建议** —— 前者的运行态与模型清单只在设置页作用域内取（
 *     `src/app/(main)/settings/hooks/use-settings-page-ollama.ts`），后者需要一条真实的
 *     失败镜头数据源；两者都没有现成出口，凭原型的样子写一份假数据比不写更糟。
 */
export function LocalComputeCard() {
  const {
    stats,
    online,
    stale,
    connecting,
    degradedNote,
    cudaVram,
    smiVram,
    ram,
  } = useComfyReadiness();

  const metrics = selectVisibleResourceMetrics({ cudaVram, smiVram, ram });

  /* 圆点档位与状态栏同一套语义：连着且新鲜 = up，连着但这一轮没读到 = busy（迟滞容忍期），
     连着而首帧未到 = probing（正在探），不在线 = down。 */
  const dotState = online
    ? stale
      ? "busy"
      : connecting
        ? "probing"
        : "up"
    : "down";

  return (
    <Card
      data-component="home-local-compute"
      className="border-border bg-surface-1 rounded-2xl"
    >
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle className="text-ink-bright flex-1">本机算力</CardTitle>
        <StatusBadge
          status={online ? "ACTIVE" : "IDLE"}
          label={online ? "在线" : "离线"}
        />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <StatusDot state={dotState} pulse={connecting} />
          <span className="text-ink-bright text-[13px] font-medium">
            ComfyUI
          </span>
          {/* 设备名来自同一份采样：读不到就不占一行，不写「未知设备」这种废话占位。 */}
          {stats?.gpuName && (
            <span
              className="text-ink-fainter min-w-0 flex-1 truncate font-mono text-[11.5px]"
              title={stats.gpuName}
            >
              {stats.gpuName}
            </span>
          )}
        </div>

        {metrics.length > 0 && (
          <div
            className={cn(
              "mt-3 grid gap-2.5 sm:grid-cols-2",
              stale && "opacity-60",
            )}
          >
            {metrics.map(({ descriptor, bar }) => (
              <ProgressBar
                key={descriptor.key}
                value={bar.pct}
                minVisible={4}
                ariaLabel={`${descriptor.label} ${bar.pct}%`}
                label={
                  <>
                    <span title={descriptor.title}>{descriptor.label}</span>
                    <span className="text-ink-fainter ml-1.5 tabular-nums">
                      {displayValue(fmtBytes(bar.used))}/
                      {displayValue(fmtBytes(bar.total))}
                    </span>
                  </>
                }
              />
            ))}
          </div>
        )}

        {/* 三条互斥的可见说明：未运行 / 首帧未到 / 显示的是上一次数据。
            只留 title 不给正文 = 用户看不出「读不到」和「没用」的区别。 */}
        {degradedNote && (
          <p className="text-ink-muted mt-2.5 text-xs">{degradedNote}</p>
        )}
        {!degradedNote && connecting && (
          <p className="text-ink-muted mt-2.5 text-xs">
            {WAIT_FIRST_SAMPLE_NOTE}
          </p>
        )}
        {!degradedNote && !connecting && stale && (
          <p className="text-warning-strong mt-2.5 text-xs">
            {STALE_RESOURCE_NOTE}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Separator className="bg-border mb-2" />
        <ButtonLink
          href="/settings"
          size="xs"
          variant="ghost"
          className="text-ink-muted"
        >
          去设置
        </ButtonLink>
      </CardFooter>
    </Card>
  );
}
