"use client";

// 横向阶段导航。全部阶段始终可点（顺序仅是推荐流），完成度由 controller 算好下发。
//
// 「每个阶段长什么样」不在这份文件里 —— 它和竖向阶段轨道共用 `WorkshopStageItem`，
// 本文件只负责横排这一种布局（等分、items-stretch、底部描边）。

import {
  STAGE_DEFS,
  stageSubtitle,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";
import { WorkshopStageItem } from "~/components/workshop/WorkshopStageItem";

interface WorkshopStageNavProps {
  tab: Tab;
  stageRatios: StageRatios;
  viewContext: StageViewContext;
  onTabChange: (tab: Tab) => void;
}

export function WorkshopStageNav({
  tab,
  stageRatios,
  viewContext,
  onTabChange,
}: WorkshopStageNavProps) {
  return (
    <nav className="border-border flex items-stretch gap-3 border-b px-6 py-4">
      {STAGE_DEFS.map((stage, index) => (
        <WorkshopStageItem
          key={stage.id}
          className="flex-1"
          label={stage.label}
          ordinal={index + 1}
          ratio={stageRatios[stage.id]}
          subtitle={stageSubtitle(stage.id, tab, stageRatios, viewContext)}
          isCurrent={tab === stage.id}
          onSelect={() => onTabChange(stage.id)}
        />
      ))}
    </nav>
  );
}
