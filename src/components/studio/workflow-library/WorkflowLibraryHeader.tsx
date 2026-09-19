"use client";

// 页头：标题 + 筛选下拉（来源 / 类型 / 模型）+ 导入按钮 + 模式契约 + 自定义节点设置。
//
// **这一排是水平布局**（ISSUE #716）：标题、三个筛选下拉、右侧动作组各占一段宽度，
// 各段一律 `shrink-0`（它们是可点目标，不许被压扁 —— 规范 03 §3.8.1），
// 排不下时**整组一起换行**（根容器 `flex-wrap`），而不是把某个下拉挤成两行小字。
//
// 为什么筛选组要单独包一层 `flex-nowrap`：三个下拉是**一组**，
// 组内换行会出现「来源 / 类型 / 模型」分别落在三行、而动作组跟在最后一行的
// 错位画面（旧形态：三个下拉各自 `w-full` 铺满整行，一共三行）。包一层之后
// 宽度压力只在「过滤组」与「动作组」之间分配，两组各自保持完整的一行。

import { Button } from "~/components/ui/button";
import { ModeContractSettings } from "./ModeContractSettings";
import { CustomNodesSettings } from "./CustomNodesSettings";
import { WorkflowLibraryFilters } from "./WorkflowLibraryFilters";
import type { SourceFilter, TypeFilter } from "./workflow-library-config";
import type { ModelTagCount } from "./WorkflowLibraryFilters";

interface WorkflowLibraryHeaderProps {
  onToggleImport: () => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (v: SourceFilter) => void;
  sourceCounts: { all: number; local: number; online: number };
  typeFilter: TypeFilter;
  onTypeFilterChange: (v: TypeFilter) => void;
  typeCounts: { all: number; image: number; video: number; audio: number };
  modelFilter: string;
  onModelFilterChange: (v: string) => void;
  modelTags: ModelTagCount[];
  onManageModels: () => void;
}

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
      <h1 className="font-title text-ink shrink-0 text-lg font-bold">
        工作流库
      </h1>

      {/* 紧凑筛选下拉：紧跟标题右侧，组内不换行（三个下拉是一组，拆行会错位） */}
      <div
        data-testid="workflow-library-header-filters"
        className="flex shrink-0 flex-nowrap items-center gap-2"
      >
        <WorkflowLibraryFilters
          sourceFilter={sourceFilter}
          onSourceFilterChange={onSourceFilterChange}
          sourceCounts={sourceCounts}
          typeFilter={typeFilter}
          onTypeFilterChange={onTypeFilterChange}
          typeCounts={typeCounts}
          modelFilter={modelFilter}
          onModelFilterChange={onModelFilterChange}
          modelTags={modelTags}
          onManageModels={onManageModels}
        />
      </div>

      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
        <Button
          onClick={onToggleImport}
          className="btn-gradient shadow-primary-500/20 hover:shadow-primary-500/30 h-auto rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg"
        >
          ＋ 导入工作流
        </Button>
        <ModeContractSettings />
        <CustomNodesSettings />
      </div>
    </div>
  );
}
