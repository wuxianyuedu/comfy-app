"use client";

// 竖向阶段轨道：工坊左侧常驻的六段入口（六段是有顺序的流程，纵向列表对齐这个
// 心智模型）。单段判据（徽章三态、小字来源、选中态）在 `WorkshopStageItem`，
// 本文件只决定排列方向与占位。**只 import `stage-config`** 是刻意的：六段互斥
// 懒加载，轨道常驻，静态引入任何一段组件就等于把所有段拉进首屏 chunk
//（`WorkshopStageRail.test.tsx` 把这条钉成用例）。

import {
  STAGE_DEFS,
  stageSubtitle,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";
import { WorkshopStageItem } from "~/components/workshop/WorkshopStageItem";

type WorkshopStageRailProps = {
  onTabChange: (tab: Tab) => void;
  stageRatios: StageRatios;
  tab: Tab;
  viewContext: StageViewContext;
};

export function WorkshopStageRail({
  tab,
  stageRatios,
  viewContext,
  onTabChange,
}: WorkshopStageRailProps) {
  return (
    <nav
      aria-label="工坊阶段"
      /* 窄屏（未达 lg）先两列横铺，避免六段竖排把内容推到首屏之外；
       * 宽屏才收成左侧一列。两种形态共用同一件条目。 */
      className="grid grid-cols-2 gap-2 lg:flex lg:min-h-0 lg:flex-col lg:gap-2 lg:overflow-y-auto"
    >
      {STAGE_DEFS.map((stage, index) => (
        <WorkshopStageItem
          className="w-full min-w-0"
          isCurrent={tab === stage.id}
          key={stage.id}
          label={stage.label}
          onSelect={() => {
            onTabChange(stage.id);
          }}
          ordinal={index + 1}
          ratio={stageRatios[stage.id]}
          subtitle={stageSubtitle(stage.id, tab, stageRatios, viewContext)}
        />
      ))}
    </nav>
  );
}
