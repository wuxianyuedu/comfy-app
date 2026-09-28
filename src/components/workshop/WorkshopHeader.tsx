"use client";

// 工坊顶栏：项目标识（只读，项目身份由首页决定）、六段流程的健康度分段条、模型适配 /
// 模式契约两个入口。纯展示，数据由 controller 下发。
//
// Phase 2：并入统一 proj_* 项目后，工坊不再有自建的项目切换器——新建 / 切换 /
// 删除项目统一在首页（canvas-store）发生，这里只展示当前所在项目的标题。
//
// 两个入口是并列的（ISSUE #597）：模型适配 = 每个远端模型 × 每个模式的字段映射；
// 模式契约 = 每种模式对外有哪些统一输入 / 输出。后者在工作流库也有一份。

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import { ProgressBar } from "~/components/ui/progress-bar";
import { toPct } from "~/lib/progress";
import { cn } from "~/lib/utils";
import { countPendingStages } from "~/components/workshop/stage-config";
import type { HealthRow } from "~/components/workshop/stage-config";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";

interface WorkshopHeaderProps {
  title: string;
  progressPct: number;
  health: HealthRow[];
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  onOpenModeContract: () => void;
}

export function WorkshopHeader({
  title,
  progressPct,
  health,
  apiChannels,
  onOpenApiSettings,
  onOpenModeContract,
}: WorkshopHeaderProps) {
  /* 唯一一份进度账在 health 里：段数与「差哪几段」都由它派生，头部不再自己数一遍。 */
  const pendingRows = health.filter((row) => row.pending);
  const pendingCount = countPendingStages(health);
  const pendingLabels = pendingRows.map((row) => row.label).join("、");
  const anyChannelConfigured =
    apiChannels?.image.configured === true ||
    apiChannels?.video.configured === true;

  return (
    <header className="border-border flex h-16 items-center gap-3 border-b px-6">
      <div className="flex flex-1 items-center gap-3">
        <div className="bg-primary grid size-9 place-items-center rounded-xl text-base font-bold text-white">
          工
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <h1 className="u-title-page truncate">{title}</h1>
          <span className="text-muted-foreground text-[11px]">
            工坊 · 全链路项目管线
          </span>
        </div>
      </div>

      {/* 各段流程的健康度：一段一根细条，条长 = 该段完成度，颜色 = 收没收尾。
          它**取代**了原先这里那根「项目总进度」条：顶栏同时挂总条与分段条，就是把
          同一件事说两遍，两处口径不一致时用户先撞上的是矛盾。总数没丢 —— 折成左边
          一个数字；「还差哪几段」仍是右侧胶囊的文字表述（色觉之外还有一条路径）。 */}
      <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
        <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
          总进度 {progressPct}%
        </span>
        <div
          role="group"
          aria-label="工坊流程健康度"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          {health.map((row) => (
            <ProgressBar
              key={row.id}
              className="min-w-0 flex-1"
              value={toPct(row.ratio, 1)}
              /* 可见段名走两字缩略：这一格只有几十像素宽，全名会被截成「场景分…」。
                 可访问名仍是全名 —— 读屏不受宽度约束，没必要跟着缩。 */
              label={row.shortLabel}
              showValue={false}
              ariaLabel={row.label}
              /* 段宽只有几十像素，2% 画不出可辨识的一格，会和「还没开始」看着
                 一样。`minVisible` 就是这条差异的既有出口（0 仍然恒为 0）。 */
              minVisible={10}
              trackClassName="bg-elevated h-1.5"
              fillClassName={row.ratio >= 1 ? "bg-success" : undefined}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* 过去这里独立数一遍 ratio，与左边的进度表述各说一次同一件事，两处一旦口径
            不同就是自相矛盾。现在胶囊只呈现「差哪几段」这段文字：条负责每段到哪，
            胶囊负责差的是哪几段，段数与名字同源于 health 快照。 */}
        <span
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium",
            pendingCount > 0
              ? "bg-amber/15 text-amber"
              : "bg-success/15 text-success-strong",
          )}
        >
          {pendingCount > 0
            ? `还差 ${pendingCount} 段：${pendingLabels}`
            : "六段流程已完成"}
        </span>
        <Hint label="为远端模型配置工坊各模式下的输入 / 输出">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onOpenApiSettings}
            className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 gap-1 rounded-full px-3 py-1.5 text-xs"
          >
            <Icon data-icon="inline-start" name="settings" size={13} />
            模型适配
            {anyChannelConfigured ? " · 已配置" : ""}
          </Button>
        </Hint>
        <Hint label="配置每种模式对外有哪些统一输入 / 输出（本地工作流按它配落点）">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onOpenModeContract}
            className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 gap-1 rounded-full px-3 py-1.5 text-xs"
          >
            <Icon data-icon="inline-start" name="settings" size={13} />
            模式契约
          </Button>
        </Hint>
      </div>
    </header>
  );
}
