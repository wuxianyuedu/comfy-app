"use client";

/**
 * 「尺寸配置表」分区（ISSUE #3788）：图片 / 视频两场景的「比例 × 分辨率」宽高表。
 *
 * 表格面板与工作坊的配置弹窗共用（`SizePresetTablePanel`，§12.18：不长第二张表）；
 * 数据的**唯一持有者**在服务端（项目默认 + 本机覆盖 `data/size-presets.json`，
 * 读取侧逐格合并），本件只渲染与改格，改完即存。
 */

import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { SettingsCard } from "~/components/ui/settings-card";
import { SizePresetTablePanel } from "~/components/studio/workflow-form/SizePresetTableModal";

import { useSizePresetTable } from "~/components/studio/workflow-form/hooks/use-size-preset-table";

export function SizePresetSection() {
  const c = useSizePresetTable();
  return (
    <SettingsCard
      title="尺寸配置表"
      titleExtra={
        <span className="flex items-center gap-1.5">
          <DataLocationBadge id="size-presets-local" />
          <DataLocationBadge id="size-presets-project" />
        </span>
      }
    >
      <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
        生成时「比例 × 分辨率」的宽高都查这张表（图片 / 视频两套口径）。
        改一格即存本机应用数据（data/size-presets.json）；项目默认跟代码走。
      </p>
      {c.status === null ? null : (
        <div className="border-warning/30 bg-warning/10 text-warning-strong mb-3 rounded-lg border px-3 py-2 text-xs">
          {c.status}
        </div>
      )}
      <SizePresetTablePanel />
    </SettingsCard>
  );
}
