"use client";

// 项目状态卡（纯展示）：六个阶段一行一条 + 四个计数。
//
// 为什么阶段条要是「文字列表」而不是仅一组彩条：这一段同时承担两个问题 ——
// 「做到哪了」（条）与「到了什么程度」（数）。只给彩色细条的话，色觉障碍用户
// 与想核对「到底 4 镜还是 8 镜」的用户都拿不到信息（规范 06）。所以每一行都是
// 「状态点 + 阶段名 + 计数」，颜色只作为情绪的叠加。

import { Check, Circle } from "lucide-react";

import { cn } from "~/lib/utils";
import { displayValue } from "~/lib/display-value";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";
import type { WorkspaceView } from "../NavItems";
import type { ProjectOverview } from "~/lib/production/project-home";

export interface ProjectHomeStatusProps {
  overview: ProjectOverview;
  /** 首次取数完成前为真：计数显示占位符而不是 0（「还没读到」≠「一个都没有」）。 */
  loading: boolean;
  onNavigate: (view: WorkspaceView) => void;
}

/** 阶段行的图标：完成 → 勾、当前 → 转圈、未开始 → 空圈。 */
function StageIcon({ done, current }: { done: boolean; current: boolean }) {
  if (done) {
    return <Check size={13} className="text-success-strong" aria-hidden />;
  }
  if (current) {
    /* 转圈走基元（P3 硬闸：自写 `animate-spin` 不许出现在视图里）。 */
    return <Spinner className="text-primary size-[13px]" />;
  }
  return <Circle size={13} className="text-ink-fainter" aria-hidden />;
}

function stageStateText(done: boolean, current: boolean): string {
  if (done) return "已完成";
  return current ? "进行中" : "未开始";
}

export function ProjectHomeStatus({
  overview,
  loading,
  onNavigate,
}: ProjectHomeStatusProps) {
  /* 计数在「还没读到」时给占位符：`displayValue(null)` 给 `—`。
   * 直接写 0 会让用户在打开主页的一瞬间读到「剧本 0 字 / 0 镜」，而那是假的。 */
  const raw = (value: number): number | null => (loading ? null : value);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
      <section className="border-border bg-panel flex flex-col gap-2 rounded-2xl border p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="u-title">制作阶段</h2>
          <span className="text-ink-faint text-[11px] tabular-nums">
            {loading
              ? ""
              : `${overview.doneCount} / ${overview.totalCount} 完成`}
          </span>
        </div>

        <ul className="flex flex-col gap-1.5">
          {overview.stages.map((stage) => (
            <li
              key={stage.id}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]",
                stage.current && "bg-primary/8",
              )}
            >
              <StageIcon done={stage.done} current={stage.current} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  stage.done ? "text-ink-muted" : "text-ink-bright",
                )}
              >
                {stage.label}
              </span>
              {stage.detail ? (
                <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">
                  {stage.detail}
                </span>
              ) : null}
              <span className="text-ink-faint w-14 shrink-0 text-right text-[11px]">
                {stageStateText(stage.done, stage.current)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border bg-panel flex flex-col gap-2 rounded-2xl border p-4">
        <h2 className="u-title">素材进度</h2>
        <KeyValueRows
          layout="rows"
          bordered
          striped
          items={[
            {
              key: "剧本",
              value: loading
                ? displayValue(null)
                : overview.hasScript
                  ? "已就绪"
                  : "未开始",
            },
            { key: "角色", raw: raw(overview.characterCount) },
            { key: "镜头", raw: raw(overview.shotCount) },
            { key: "镜头图", raw: raw(overview.imageDoneCount) },
            { key: "视频片段", raw: raw(overview.clipDoneCount) },
            {
              key: "成片",
              value: loading
                ? displayValue(null)
                : overview.filmRendered
                  ? "已合成"
                  : "未合成",
            },
          ]}
        />
        <Button
          variant="link"
          onClick={() => onNavigate("workshop")}
          className="text-ink-muted hover:text-ink-strong h-auto self-start p-0 text-[11px]"
        >
          去工坊继续 →
        </Button>
      </section>
    </div>
  );
}
