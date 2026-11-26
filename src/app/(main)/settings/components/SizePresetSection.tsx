"use client";

/**
 * 「尺寸配置表」分区（ISSUE #3788）：图片 / 视频两场景的「比例 × 分辨率」宽高表。
 *
 * 表格面板与工作坊的配置弹窗共用（`SizePresetTablePanel`，§12.18：不长第二张表）；
 * 数据的**唯一持有者**在服务端（项目默认入库在 `src/lib/media/size-preset-defaults.json`，
 * 本机覆盖落 `data/size-presets.json`，读取侧逐格合并），本件只渲染与改格，改完即存。
 *
 * 保存口径（ISSUE #3948）：本机覆盖**改一格即存**（落应用数据，开发版与正式包
 * 都能用）；项目默认那份入库 JSON 是编译期基线，运行期只读不写（ISSUE #5001）——
 * 改它走改代码 / 提 PR 那条路。
 */

import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { SettingsCard } from "~/components/ui/settings-card";
import { SizePresetTablePanel } from "~/components/studio/workflow-form/SizePresetTableModal";

export function SizePresetSection() {
  /* 表格面板自己订阅尺寸表快照（画布 / 表单与设置页共用同一份数据源）。 */
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
        改一格即存本机应用数据（data/size-presets.json）；项目默认跟代码走
        （src/lib/media/size-preset-defaults.json）。
      </p>
      <SizePresetTablePanel />
    </SettingsCard>
  );
}
