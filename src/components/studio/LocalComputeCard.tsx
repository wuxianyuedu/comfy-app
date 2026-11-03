"use client";

import { ButtonLink } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
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
 * 首页「本机算力」总览卡。放在首页而非让人滚到底部状态栏去看：状态栏那一格是**结果**（三个百分比数字），用户问的却是**原因** —— 后端在不在线、显存够不够、读不到是「没启动」还是「暂时读不到」，三种情形处置完全不同，卡片把它们分开说（徽标 + 状态行 + 一句可见降级说明）。数据来源**只有** `useComfyReadiness()`：轮询收在 `src/lib/comfy/comfy-stats-store.ts` 这一个持有者里（与状态栏共用同一条，首页挂这份不会多一路轮询），视图层零 IO（规范 §17）。
 * 刻意没搬原型里的「队列 / 历史计数」（`useComfyQueue` 的轮询已收在 `~/lib/comfy/comfy-queue-store.ts`）与「Ollama / 显存不足建议」（两者都没有现成出口，凭原型写假数据比不写更糟）。
 * 圆点档位与状态栏同一套语义：连着且新鲜 = up，连着但这一轮没读到 = busy（迟滞容忍期），连着而首帧未到 = probing，不在线 = down。
 */
export function LocalComputeCard() {
  const { stats, online, stale, connecting, degradedNote, cudaVram, smiVram, ram } =
    useComfyReadiness();

  const metrics = selectVisibleResourceMetrics({ cudaVram, smiVram, ram });

  /* 圆点档位与状态栏同一套语义：连着且新鲜 = up，连着但这一轮没读到 = busy（迟滞容忍期），
     连着而首帧未到 = probing（正在探），不在线 = down。 */
  const dotState = online ? (stale ? "busy" : connecting ? "probing" : "up") : "down";

  return (
    <Card className="border-border bg-surface-1 rounded-2xl" data-component="home-local-compute">
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle className="text-ink-bright flex-1">本机算力</CardTitle>
        <StatusBadge label={online ? "在线" : "离线"} status={online ? "ACTIVE" : "IDLE"} />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <StatusDot pulse={connecting} state={dotState} />
          <span className="text-ink-bright text-sm font-medium">ComfyUI</span>
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
          <div className={cn("mt-3 grid gap-2.5 sm:grid-cols-2", stale && "opacity-60")}>
            {metrics.map(({ descriptor, bar }) => (
              <ProgressBar
                ariaLabel={`${descriptor.label} ${bar.pct}%`}
                key={descriptor.key}
                label={
                  <>
                    <span title={descriptor.title}>{descriptor.label}</span>
                    <span className="text-ink-fainter ml-1.5 tabular-nums">
                      {displayValue(fmtBytes(bar.used))}/{displayValue(fmtBytes(bar.total))}
                    </span>
                  </>
                }
                minVisible={4}
                value={bar.pct}
              />
            ))}
          </div>
        )}

        {/* 三条互斥的可见说明：未运行 / 首帧未到 / 显示的是上一次数据。
            只留 title 不给正文 = 用户看不出「读不到」和「没用」的区别。 */}
        {degradedNote && <p className="text-ink-muted mt-2.5 text-xs">{degradedNote}</p>}
        {!degradedNote && connecting && (
          <p className="text-ink-muted mt-2.5 text-xs">{WAIT_FIRST_SAMPLE_NOTE}</p>
        )}
        {!degradedNote && !connecting && stale && (
          <p className="text-warning-strong mt-2.5 text-xs">{STALE_RESOURCE_NOTE}</p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Separator className="bg-border mb-2" />
        <ButtonLink className="text-ink-muted" href="/settings" size="xs" variant="ghost">
          去设置
        </ButtonLink>
      </CardFooter>
    </Card>
  );
}
