"use client";

/**
 * 「尺寸配置表」分区（ISSUE #3788）：图片 / 视频两场景的「比例 × 分辨率」宽高表。
 *
 * 表格面板与工作坊的配置弹窗共用（`SizePresetTablePanel`，§12.18：不长第二张表）；
 * 数据的**唯一持有者**在服务端（项目默认入库在 `src/lib/media/size-preset-defaults.json`，
 * 本机覆盖落 `data/size-presets.json`，读取侧逐格合并），本件只渲染与改格，改完即存。
 *
 * 两种保存口径与「界面页签行为」「模式契约」同一套（ISSUE #3948）：
 *   · 本机覆盖 —— **改一格即存**（落应用数据，开发版与正式包都能用）；
 *   · 「保存为项目默认（跟代码走）」 —— 写入库那份 JSON，只有开发检出可用。
 */

import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { Button } from "~/components/ui/button";
import { SettingsCard } from "~/components/ui/settings-card";
import { SizePresetTablePanel } from "~/components/studio/workflow-form/SizePresetTableModal";

import { useSizePresetTable } from "~/components/studio/workflow-form/hooks/use-size-preset-table";

export function SizePresetSection() {
  /* 订阅尺寸表快照（画布 / 表单与设置页共用同一份 React Query 之外的 store）。 */
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
        改一格即存本机应用数据（data/size-presets.json）；项目默认跟代码走
        （src/lib/media/size-preset-defaults.json）。
      </p>
      <SizePresetTablePanel />

      {/* 「保存为项目默认（跟代码走）」：只有开发检出有可写的目标文件（正式包没有源码可写）。
          写的是**当前这份表**（本机覆盖 + 项目默认合起来的那份），提交后每个检出
          与每个桌包都是它 —— 与「界面页签」「模式契约」的项目默认同一套口径与同一句
          文案（§12.14：同一件事只许一种说法）。 */}
      {c.projectDefaultEditable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            disabled={c.savingProjectDefaults}
            onClick={() => {
              void c.saveAsProjectDefaults();
            }}
            variant="outline"
          >
            {c.savingProjectDefaults ? "写入中…" : "保存为项目默认（跟代码走）"}
          </Button>
        </div>
      )}

      {c.status && (
        <p className="bg-success/10 text-success-strong mt-3 rounded-lg px-3 py-2 text-xs">
          {c.status}
        </p>
      )}
    </SettingsCard>
  );
}
