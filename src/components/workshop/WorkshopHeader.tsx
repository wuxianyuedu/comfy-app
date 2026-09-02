"use client";

// 工坊顶栏：项目标识、总进度、API 通道入口。纯展示，数据由 controller 下发。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";

interface WorkshopHeaderProps {
  title: string;
  progressPct: number;
  pendingCategories: number;
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
}

export function WorkshopHeader({
  title,
  progressPct,
  pendingCategories,
  apiChannels,
  onOpenApiSettings,
}: WorkshopHeaderProps) {
  const anyChannelConfigured =
    apiChannels?.image.configured === true ||
    apiChannels?.video.configured === true;

  return (
    <header className="border-border flex h-16 items-center gap-3 border-b px-6">
      <div className="flex flex-1 items-center gap-3">
        <div className="bg-primary grid h-9 w-9 place-items-center rounded-xl text-base font-bold text-white">
          工
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-ink text-[17px] font-semibold">
            工坊 · 全链路项目管线
          </span>
          <span className="text-muted-foreground text-[11px]">
            Comfy-APP / 项目管线
          </span>
        </div>
        <span className="text-muted-foreground ml-4 rounded-lg bg-white/4 px-3 py-1.5 text-[13px]">
          {title}
        </span>
      </div>

      {/* 项目总进度：放到最顶部（设计稿红框区域） */}
      <div className="hidden w-full max-w-[260px] lg:block">
        <div className="text-muted-foreground flex items-center justify-between text-[11px]">
          <span>项目总进度</span>
          <span className="text-primary font-medium">{progressPct}%</span>
        </div>
        <div className="bg-elevated mt-1.5 h-2 w-full rounded-full">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <span className="rounded-full bg-(--color-amber)/15 px-3 py-1.5 text-xs font-medium text-(--color-amber)">
          距离成片还差 {pendingCategories} 个阶段
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink gap-1 rounded-full bg-white/4 px-3 py-1.5 text-xs hover:bg-white/8"
          title="配置生图 / 视频 API 直连通道"
        >
          <Icon name="settings" size={13} />
          API 通道
          {anyChannelConfigured ? " · 已配置" : ""}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="账户"
          className="bg-primary/50 rounded-full text-white"
        >
          <Icon name="user" size={16} />
        </Button>
      </div>
    </header>
  );
}
