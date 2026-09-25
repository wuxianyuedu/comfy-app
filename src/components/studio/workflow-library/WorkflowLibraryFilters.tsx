"use client";

// 三级筛选（来源 / 类型 / 模型标签）的紧凑下拉版：替代原先三行平铺页签，
// 由页头「工作流库」标题右侧统一收纳，减少垂直空间占用。
// 计数以徽标形式并入每个选项行；「管理模型」作为模型下拉的固定末项入口。
//
// **这一组必须排成一行**（ISSUE #716）：三个下拉 + 「管理模型」按钮，
// 组内 `flex-nowrap`、每项 `shrink-0`。它们此前是 `flex-wrap` + 每项 `w-auto`，
// 在窄宽度下会各自折行，形成「三个下拉竖着叠成一列」的形态 —— 页头因此吃掉
// 三行高度，用户看到的是「筛选菜单不是水平排列的」。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { SelectMenu } from "~/components/ui/select-menu";
import type { SourceFilter, TypeFilter } from "./workflow-library-config";

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

const SOURCE_OPTIONS = ["all", "local", "online"] as const;
const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: "全部来源",
  local: "本地工作流",
  online: "在线工作流",
};

const TYPE_OPTIONS = ["all", "image", "video", "audio"] as const;
const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "全部类型",
  image: "图像",
  video: "视频",
  audio: "音频",
};

/** 计数徽标（ SelectMenu 的 labels 支持 ReactNode）。 */
function CountBadge({ count }: { count: number }) {
  return (
    <span className="bg-surface-2 text-ink-faint ml-2 shrink-0 rounded-full px-1.5 text-[11px] tabular-nums">
      {count}
    </span>
  );
}

/**
 * 筛选触发按钮的统一样式。
 *
 * `w-auto` + `min-w`（不是统一的 `w-[Npx]`）：三个下拉的选项文案长短不同
 *（「全部来源」vs「全部模型」vs 某个模型标签名），固定宽度要么把长文案截掉、
 *  要么在短文案上留一块空白。`shrink-0` 是硬要求 —— 这排控件不许被压扁
 *  （规范 03 §3.8.1），排不下由外层整组换行。
 */
const TRIGGER_CLS =
  "w-auto min-w-[112px] shrink-0 gap-x-1 rounded-full px-3 py-1 text-xs";

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
    <div
      data-testid="workflow-library-filter-row"
      className="flex flex-nowrap items-center gap-2"
    >
      <SelectMenu
        value={sourceFilter}
        onChange={(v) => onSourceFilterChange(v as SourceFilter)}
        options={[...SOURCE_OPTIONS]}
        className={TRIGGER_CLS}
        popoverMinWidth={150}
        labels={Object.fromEntries(
          SOURCE_OPTIONS.map((key) => [
            key,
            <span className="flex items-center justify-between gap-2" key={key}>
              <span>{SOURCE_LABELS[key]}</span>
              <CountBadge
                count={
                  key === "all"
                    ? sourceCounts.all
                    : key === "local"
                      ? sourceCounts.local
                      : sourceCounts.online
                }
              />
            </span>,
          ]),
        )}
      />

      <SelectMenu
        value={typeFilter}
        onChange={(v) => onTypeFilterChange(v as TypeFilter)}
        options={[...TYPE_OPTIONS]}
        className={TRIGGER_CLS}
        popoverMinWidth={140}
        labels={Object.fromEntries(
          TYPE_OPTIONS.map((key) => [
            key,
            <span className="flex items-center justify-between gap-2" key={key}>
              <span>{TYPE_LABELS[key]}</span>
              <CountBadge
                count={
                  key === "all"
                    ? typeCounts.all
                    : key === "image"
                      ? typeCounts.image
                      : key === "video"
                        ? typeCounts.video
                        : typeCounts.audio
                }
              />
            </span>,
          ]),
        )}
      />

      <SelectMenu
        value={modelFilter}
        onChange={(v) => onModelFilterChange(v)}
        options={["all", ...modelTags.map((tag) => tag.name)]}
        className={TRIGGER_CLS}
        popoverMinWidth={160}
        placeholder="全部模型"
        labels={{
          all: (
            <span className="flex items-center justify-between gap-2">
              <span>全部模型</span>
              <CountBadge
                count={modelTags.reduce((sum, tag) => sum + tag.count, 0)}
              />
            </span>
          ),
          ...Object.fromEntries(
            modelTags.map((tag) => [
              tag.name,
              <span
                className="flex items-center justify-between gap-2"
                key={tag.id}
              >
                <span>{tag.name}</span>
                <CountBadge count={tag.count} />
              </span>,
            ]),
          ),
        }}
      />

      <Button
        variant="outline"
        onClick={onManageModels}
        className="border-border-strong text-ink-strong hover:bg-subtle h-auto shrink-0 gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
        title="管理模型标签库"
      >
        <Icon name="tag" className="size-3.5" />
        管理模型
      </Button>
    </div>
  );
}
