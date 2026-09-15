"use client";

// 页头：标题 + 筛选下拉（来源 / 类型 / 模型）+ 导入按钮 + 模式契约 + 自定义节点设置。
// 筛选由原来的三行页签压缩为标题右侧的三个下拉（减少垂直空间占用）。

import { ModeContractSettings } from "./ModeContractSettings";
import { CustomNodesSettings } from "./CustomNodesSettings";
import { WorkflowLibraryFilters } from "./WorkflowLibraryFilters";
import type {
  SourceFilter,
  TypeFilter,
} from "./workflow-library-config";
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle px-5 py-2.5">
      <h1 className="font-title text-lg font-bold text-ink">工作流库</h1>

      {/* 紧凑筛选下拉：紧跟标题右侧 */}
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

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleImport}
          className="btn-gradient rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:shadow-violet-500/30"
        >
          ＋ 导入工作流
        </button>
        <ModeContractSettings />
        <CustomNodesSettings />
      </div>
    </div>
  );
}
