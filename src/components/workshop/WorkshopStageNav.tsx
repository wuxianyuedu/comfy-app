"use client";

// 横向阶段导航。全部阶段始终可点（顺序仅是推荐流），完成度由 controller 算好下发。

import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import {
  STAGE_DEFS,
  stageSubtitle,
  type StageRatios,
  type StageViewContext,
  type Tab,
} from "~/components/workshop/stage-config";

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
      {STAGE_DEFS.map((stage, index) => {
        const active = tab === stage.id;
        const ratio = stageRatios[stage.id];
        return (
          <Button
            key={stage.id}
            variant="ghost"
            onClick={() => onTabChange(stage.id)}
            aria-current={active ? "step" : undefined}
            className={`flex h-auto flex-1 items-center gap-3 rounded-xl px-4 py-3 font-normal ${
              active
                ? "bg-primary/12 ring-primary/25 hover:bg-primary/12 ring-1"
                : "bg-surface hover:bg-surface"
            }`}
          >
            <span
              className={`grid h-9 w-9 place-items-center rounded-[11px] text-[15px] font-bold ${
                ratio >= 1
                  ? "bg-emerald-500/80 text-white"
                  : active
                    ? "bg-primary text-white"
                    : "bg-elevated text-muted-foreground"
              }`}
            >
              {ratio >= 1 ? <Icon name="check" size={14} /> : index + 1}
            </span>
            <div className="leading-tight">
              <div
                className={`text-[13.5px] font-semibold ${active ? "text-primary" : "text-ink"}`}
              >
                {stage.label}
              </div>
              <div
                className={`text-[11px] ${ratio >= 1 ? "text-success-strong" : "text-muted-foreground"}`}
              >
                {stageSubtitle(stage.id, tab, stageRatios, viewContext)}
              </div>
            </div>
          </Button>
        );
      })}
    </nav>
  );
}
