"use client";

// 项目页左侧列表（ISSUE #4765）：一项目一页签之后，项目内的去处在左列表里选。
// 三组：入口（概览 / 画布）→ 创作阶段（工坊六段，编号 1~6，状态口径与项目主页
// 同一份 production 派生，不在列表里自算第二份）→ 素材与成果（资源库 / 产出 / 成片）。
// 「删除项目」也挂在列表底部 —— 项目界面内的删除入口（ISSUE #4765 验收第 3 条）。

import type { ReactNode } from "react";
import { Film, FolderOpen, Home, Image as ImageIcon, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { WorkshopStageItem } from "~/components/workshop/WorkshopStageItem";
import { STAGE_DEFS } from "~/components/workshop/stage-config";
import type { ProjectOverview } from "~/lib/production/project-home";
import type { ProjectSection } from "./project-sections";

/** 与 `NavItems` 同形的入口图标：画布沿用它的自绘 svg，其余用 lucide 同名件。 */
function CanvasIcon() {
  return (
    <svg
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M3 9h18M9 21V9" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}

type RailEntry = {
  icon: ReactNode;
  id: ProjectSection;
  label: string;
  subtitle: string;
};

/** 非编号入口：概览 / 画布 + 素材与成果。编号的工坊六段走 `WorkshopStageItem`。 */
const ENTRIES: Array<RailEntry> = [
  { id: "overview", label: "概览", subtitle: "项目状态与入口", icon: <Home size={16} /> },
  { id: "canvas", label: "画布", subtitle: "自由编排节点工作流", icon: <CanvasIcon /> },
];

const TAIL_ENTRIES: Array<RailEntry> = [
  { id: "library", label: "资源库", subtitle: "素材与参考", icon: <FolderOpen size={16} /> },
  { id: "outputs", label: "产出", subtitle: "生成的图片与视频", icon: <ImageIcon size={16} /> },
  { id: "film", label: "成片", subtitle: "时间线与合成", icon: <Film size={16} /> },
];

function RailEntryButton({
  active,
  entry,
  onSelect,
}: {
  active: boolean;
  entry: RailEntry;
  onSelect: (section: ProjectSection) => void;
}) {
  return (
    <Button
      aria-current={active ? "page" : undefined}
      className={cn(
        "h-auto w-full justify-start gap-3 rounded-xl px-4 py-2.5 font-normal",
        active
          ? "bg-primary/12 ring-primary/25 hover:bg-primary/20 ring-1"
          : "bg-surface hover:bg-subtle",
      )}
      onClick={() => {
        onSelect(entry.id);
      }}
      variant="ghost"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[11px]",
          active ? "bg-primary text-white" : "bg-elevated text-muted-foreground",
        )}
      >
        {entry.icon}
      </span>
      <span className="min-w-0 text-left leading-tight">
        <span
          className={cn(
            "block truncate text-[13.5px] font-semibold",
            active ? "text-primary" : "text-ink",
          )}
        >
          {entry.label}
        </span>
        <span className="text-muted-foreground text-2xs block truncate">{entry.subtitle}</span>
      </span>
    </Button>
  );
}

export type ProjectSectionRailProps = {
  current: ProjectSection;
  /** 删除项目（列表底部的危险入口，确认弹窗由容器挂）。 */
  onDelete: () => void;
  onSelect: (section: ProjectSection) => void;
  /** 阶段状态口径 = 项目主页那份 production 派生（done / current），不另算。 */
  overview: ProjectOverview;
};

export function ProjectSectionRail({
  current,
  onDelete,
  onSelect,
  overview,
}: ProjectSectionRailProps) {
  return (
    <nav aria-label="项目分区" className="flex min-h-0 flex-col gap-1.5">
      {ENTRIES.map((entry) => (
        <RailEntryButton
          active={current === entry.id}
          entry={entry}
          key={entry.id}
          onSelect={onSelect}
        />
      ))}

      <p className="text-ink-fainter text-2xs mt-2 px-2 font-semibold">创作阶段</p>
      {STAGE_DEFS.map((stage, index) => {
        const row = overview.stages.find((s) => s.id === stage.id);
        const done = row?.done ?? false;
        const subtitle = done ? "已完成" : row?.current === true ? "进行中" : "待开始";
        return (
          <WorkshopStageItem
            className="w-full min-w-0"
            isCurrent={current === stage.id}
            key={stage.id}
            label={stage.label}
            onSelect={() => {
              onSelect(stage.id);
            }}
            ordinal={index + 1}
            ratio={done ? 1 : 0}
            subtitle={subtitle}
          />
        );
      })}

      <p className="text-ink-fainter text-2xs mt-2 px-2 font-semibold">素材与成果</p>
      {TAIL_ENTRIES.map((entry) => (
        <RailEntryButton
          active={current === entry.id}
          entry={entry}
          key={entry.id}
          onSelect={onSelect}
        />
      ))}

      <Button
        aria-label="删除当前项目"
        className="text-ink-muted hover:bg-danger/15 hover:text-danger-strong mt-3 h-auto justify-start gap-2 rounded-xl px-4 py-2.5"
        onClick={onDelete}
        size="sm"
        variant="ghost"
      >
        <Trash2 data-icon="inline-start" size={14} />
        <span>删除项目</span>
      </Button>
    </nav>
  );
}
