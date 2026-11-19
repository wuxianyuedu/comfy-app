"use client";

// 三级筛选（来源 / 类型 / 模型标签）的紧凑下拉版，由页头标题右侧统一收纳；
// 计数以徽标并入选项行，「管理模型」是模型下拉的固定末项。
//
// **这一组必须排成一行**（ISSUE #716）：组内 `flex-nowrap`、每项 `shrink-0`；
// 此前 `flex-wrap` + `w-auto` 在窄宽度下会折成竖列、页头吃掉三行。

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import { SelectMenu } from "~/components/ui/select-menu";
import type { SourceFilter, TypeFilter } from "./workflow-library-config";

export type ModelTagCount = {
  count: number;
  id: string;
  name: string;
};

type WorkflowLibraryFiltersProps = {
  modelFilter: string;
  modelTags: Array<ModelTagCount>;
  onManageModels: () => void;
  onModelFilterChange: (v: string) => void;
  onSourceFilterChange: (v: SourceFilter) => void;
  onTypeFilterChange: (v: TypeFilter) => void;
  sourceCounts: { all: number; local: number; online: number };
  sourceFilter: SourceFilter;
  typeCounts: { all: number; audio: number; image: number; video: number };
  typeFilter: TypeFilter;
};

/* SAFETY: 类型断言已复核 */
const SOURCE_OPTIONS = ["all", "local", "online"] as const;
const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: "全部来源",
  local: "本地工作流",
  online: "在线工作流",
};

/* SAFETY: 类型断言已复核 */
const TYPE_OPTIONS = ["all", "image", "video", "audio"] as const;
const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "全部类型",
  image: "图像",
  video: "视频",
  audio: "音频",
};

function isSourceFilter(value: string): value is SourceFilter {
  return Object.hasOwn(SOURCE_LABELS, value);
}

function isTypeFilter(value: string): value is TypeFilter {
  return Object.hasOwn(TYPE_LABELS, value);
}

/** 计数徽标（ SelectMenu 的 labels 支持 ReactNode）。 */
function CountBadge({ count }: { count: number }) {
  return (
    <span className="bg-surface-2 text-ink-faint text-2xs ml-2 shrink-0 rounded-full px-1.5 tabular-nums">
      {count}
    </span>
  );
}

/**
 * 筛选触发按钮的统一样式：`w-auto` + `min-w`（选项文案长短不同，固定宽度会
 * 截掉长文案或给短文案留白）。`shrink-0` 是硬要求（规范 03 §3.8.1），排不下
 * 由外层整组换行，不许把控件压扁。
 */
const TRIGGER_CLS = "w-auto min-w-28 shrink-0 gap-x-1 rounded-full px-3 py-1 text-xs";

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
    <div className="flex flex-nowrap items-center gap-2" data-testid="workflow-library-filter-row">
      <SelectMenu
        className={TRIGGER_CLS}
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
        onChange={(v) => {
          if (isSourceFilter(v)) {
            onSourceFilterChange(v);
          }
        }}
        options={[...SOURCE_OPTIONS]}
        popoverMinWidth={150}
        value={sourceFilter}
      />

      <SelectMenu
        className={TRIGGER_CLS}
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
        onChange={(v) => {
          if (isTypeFilter(v)) {
            onTypeFilterChange(v);
          }
        }}
        options={[...TYPE_OPTIONS]}
        popoverMinWidth={140}
        value={typeFilter}
      />

      <SelectMenu
        className={TRIGGER_CLS}
        labels={{
          all: (
            <span className="flex items-center justify-between gap-2">
              <span>全部模型</span>
              <CountBadge count={modelTags.reduce((sum, tag) => sum + tag.count, 0)} />
            </span>
          ),
          ...Object.fromEntries(
            modelTags.map((tag) => [
              tag.name,
              <span className="flex items-center justify-between gap-2" key={tag.id}>
                <span>{tag.name}</span>
                <CountBadge count={tag.count} />
              </span>,
            ]),
          ),
        }}
        onChange={(v) => {
          onModelFilterChange(v);
        }}
        options={["all", ...modelTags.map((tag) => tag.name)]}
        placeholder="全部模型"
        popoverMinWidth={160}
        value={modelFilter}
      />

      <Hint label="管理模型标签库">
        <Button
          className="border-border-strong text-ink-strong hover:bg-subtle h-auto shrink-0 gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
          onClick={onManageModels}
          variant="outline"
        >
          <Icon className="size-3.5" data-icon="inline-start" name="tag" />
          管理模型
        </Button>
      </Hint>
    </div>
  );
}
