"use client";

// 页头：标题 + 筛选下拉（来源 / 类型 / 模型）+ 导入按钮 + 自定义节点设置。
//
// **水平布局**（ISSUE #716）：各段 `shrink-0`（可点目标不许压扁，规范 03 §3.8.1），
// 排不下时整组换行（根容器 `flex-wrap`）。筛选组单独包一层 `flex-nowrap`，
// 组内换行会让「来源 / 类型 / 模型」落在三行、动作组跟错位。

import { FolderInput } from "lucide-react";

import { pageHeaderTitle } from "../NavItems";
import { Button } from "~/components/ui/button";
import { CustomNodesSettings } from "./CustomNodesSettings";
import { WorkflowLibraryFilters } from "./WorkflowLibraryFilters";
import {
  HEADER_ACTION_OUTLINE_BTN,
  type SourceFilter,
  type TypeFilter,
} from "./workflow-library-config";
import type { ModelTagCount } from "./WorkflowLibraryFilters";

type WorkflowLibraryHeaderProps = {
  modelFilter: string;
  modelTags: Array<ModelTagCount>;
  onManageModels: () => void;
  onModelFilterChange: (v: string) => void;
  onSourceFilterChange: (v: SourceFilter) => void;
  onToggleImport: () => void;
  onTypeFilterChange: (v: TypeFilter) => void;
  sourceCounts: { all: number; local: number; online: number };
  sourceFilter: SourceFilter;
  typeCounts: { all: number; audio: number; image: number; video: number };
  typeFilter: TypeFilter;
};

export function WorkflowLibraryHeader({
  onToggleImport,
  sourceFilter,
  onSourceFilterChange,
  sourceCounts,
  typeFilter,
  onTypeFilterChange,
  typeCounts,
  modelFilter,
  onModelFilterChange,
  modelTags,
  onManageModels,
}: WorkflowLibraryHeaderProps) {
  return (
    <div className="border-border-subtle flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2.5">
      {/* 屏名退到 `sr-only`，视觉上不再占这一行（ISSUE #1847 / #1693）：
          顶栏（`TopBar`）与页签常驻已写着「工作流库」，屏内再写一遍是同一个名字
          出现两次 —— 读者什么都没多知道，标题区却实打实吃掉一整行。
          名字仍从注册表取（`pageHeaderTitle`），不在这里另写一份字面量；
          `sr-only` 也保证读屏仍能按 `h1` 跳转（「别占空间」≠「没有标题」）。 */}
      <h1 className="sr-only">{pageHeaderTitle("workflows")}</h1>

      {/* 紧凑筛选下拉：紧跟标题右侧，组内不换行（三个下拉是一组，拆行会错位） */}
      <div
        className="flex shrink-0 flex-nowrap items-center gap-2"
        data-testid="workflow-library-header-filters"
      >
        <WorkflowLibraryFilters
          modelFilter={modelFilter}
          modelTags={modelTags}
          onManageModels={onManageModels}
          onModelFilterChange={onModelFilterChange}
          onSourceFilterChange={onSourceFilterChange}
          onTypeFilterChange={onTypeFilterChange}
          sourceCounts={sourceCounts}
          sourceFilter={sourceFilter}
          typeCounts={typeCounts}
          typeFilter={typeFilter}
        />
      </div>

      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        {/* 导入按钮与右侧两枚动作按钮同款（ISSUE #3759）：描边 + 弱底，不再单独
            用实心品牌色抬高。 */}
        <Button className={HEADER_ACTION_OUTLINE_BTN} onClick={onToggleImport} variant="outline">
          <FolderInput data-icon="inline-start" size={13} />
          导入工作流
        </Button>
        <CustomNodesSettings />
      </div>
    </div>
  );
}
