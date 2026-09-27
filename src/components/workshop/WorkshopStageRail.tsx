"use client";

// 竖向阶段轨道：工坊左侧常驻的六段入口。
//
// 为什么换竖向：横条把六段等分挤在一行里，段名与小字只能各占极窄的空间，
// 「我现在在哪一段、后面还有几段空的」要扫一遍才能读出来；而六段是**有顺序的
// 流程**，纵向列表天然对齐这个心智模型，也让每段的两行文字有稳定宽度。
//
// 判据不在这里重复：单段长什么样（徽章三态、小字来源、选中态）与横条时期是
// 同一份 `WorkshopStageItem`；本文件只决定排列方向与占位方式。
//
// **只 import `stage-config`** 是刻意的：六段是互斥懒加载（每段单独切 bundle，
// 见 `WorkshopStageBody` 的 React.lazy 列表），轨道常驻，一旦在这里静态引入
// 任何一段的组件，就等于把所有段拉进首屏 chunk，懒加载整体失效。
// `WorkshopStageRail.test.tsx` 把这条钉成用例，不靠注释提醒。

import {
  STAGE_DEFS,
  stageSubtitle,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";
import { WorkshopStageItem } from "~/components/workshop/WorkshopStageItem";

interface WorkshopStageRailProps {
  tab: Tab;
  stageRatios: StageRatios;
  viewContext: StageViewContext;
  onTabChange: (tab: Tab) => void;
}

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
          key={stage.id}
          className="w-full min-w-0"
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
