"use client";

/** 2026-08-29 T12-3: extracted from WorkflowLibrary's three filter-tab
 *  rows (source / type / model) plus the "管理模型" shortcut.
 */
import { Icon } from "@/components/ui/Icon";
import { FilterTabs } from "./WorkflowLibraryHelpers";

export type SourceFilter = "all" | "local" | "online";
export type TypeFilter = "all" | "image" | "video" | "audio";

export interface ModelTagCount {
  id: string;
  name: string;
  count: number;
}

interface WorkflowLibraryFiltersProps {
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

export function WorkflowLibraryFilters({
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
}: WorkflowLibraryFiltersProps) {
  return (
    <>
      {/* ── Source filter tabs: 本地工作流 vs 在线工作流 ── */}
      <FilterTabs
        tabs={
          [
            { key: "all", label: "全部", count: sourceCounts.all },
            { key: "local", label: "本地工作流", count: sourceCounts.local },
            { key: "online", label: "在线工作流", count: sourceCounts.online },
          ] as const
        }
        active={sourceFilter}
        onChange={(key) => onSourceFilterChange(key)}
        accent="violet"
      />

      {/* ── Type filter (R70-3): 全部类型 / 图像 / 视频 / 音频 ── */}
      <FilterTabs
        tabs={
          [
            { key: "all", label: "全部类型", count: typeCounts.all },
            { key: "image", label: "图像", count: typeCounts.image },
            { key: "video", label: "视频", count: typeCounts.video },
            { key: "audio", label: "音频", count: typeCounts.audio },
          ] as const
        }
        active={typeFilter}
        onChange={(key) => onTypeFilterChange(key)}
        accent="sky"
      />

      {/* ── 2026-08-15 模型筛选 + 标签库管理 ── */}
      <FilterTabs
        tabs={[
          {
            key: "all",
            label: "全部模型",
            count: modelTags.reduce((sum, tag) => sum + tag.count, 0),
          },
          ...modelTags.map((modelTag) => ({
            key: modelTag.name,
            label: modelTag.name,
            count: modelTag.count,
          })),
        ]}
        active={modelFilter}
        onChange={(key) =>
          onModelFilterChange(key === modelFilter ? "all" : key)
        }
        accent="fuchsia"
        trailing={
          <button
            type="button"
            onClick={onManageModels}
            className="ml-1 flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5"
          >
            <Icon name="tag" className="h-3.5 w-3.5" />
            管理模型
          </button>
        }
      />
    </>
  );
}
