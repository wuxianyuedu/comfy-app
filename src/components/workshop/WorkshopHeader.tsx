"use client";

// 工坊顶栏：项目标识（只读，项目身份由首页决定）、总进度、模型适配 / 模式契约两个入口。
// 纯展示，数据由 controller 下发。
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

      {/* 项目总进度：放到最顶部（设计稿红框区域） */}
      <ProgressBar
        value={progressPct}
        label="项目总进度"
        className="hidden w-full max-w-[260px] text-[11px] lg:block"
        trackClassName="bg-elevated mt-1.5 h-2"
      />

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* 过去这里独立数一遍 ratio，和总进度条各说一次同一件事，两处一旦口径不同就是
            自相矛盾。现在胶囊只呈现「差哪几段」，段数与名字同源于 health 快照。 */}
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
