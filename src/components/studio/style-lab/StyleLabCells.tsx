"use client";

// ── 风格实验室 · 座位表（第③层，纯视图）───────────────────────────────
//
// 展开某一条试验之后，这一块回答的是屏上最实在的两个问题：这一批跑没跑、跑出来的
// 每张是什么。它不取数（第②层的 controller 给），也不含判据（第①层的 config 给），
// 只做「把每格的状态与成品图铺成一个可点开的网格」。
//
// 动作按钮放在这一块而不是列表行上：跑一批 / 停一批的对象就是「这一条试验的这批格子」，
// 与展开看到的那张座位表是同一件事，分开两处会让人不确定按钮究竟作用在谁身上。

import { Ban, Play } from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { ViewableImage } from "~/components/ui/image-viewer";
import { isActiveTaskStatus } from "~/lib/task-state";

import {
  cellStatusText,
  completionText,
  styleDisplayText,
  traitKeyDisplayText,
} from "./style-lab-config";
import type { StyleLabController } from "./hooks/use-style-lab";
import type { StyleLabListItem } from "~/lib/style-lab/style-lab-types";

/** 这一格的说明文字（缩略图的替代文本与查看器标题同一份）。 */
function cellCaption(cell: { style: string; traitKey: string }): string {
  return `${styleDisplayText(cell.style)} · ${traitKeyDisplayText(cell.traitKey)}`;
}

export function StyleLabCells({
  c,
  experiment,
}: {
  c: StyleLabController;
  experiment: StyleLabListItem;
}) {
  /* 只有展开的那一条才拿得到格子（座位表按 `expandedId` 现读，列表不必每行都带着
     一串任务状态）。收起时这里不渲染任何一块。 */
  if (c.expandedId !== experiment.id) return null;

  const running = c.runningBatchId === experiment.id;
  const stopping = c.stoppingBatchId === experiment.id;
  /* 「停一批」只在真的还有在跑的格子时才摆：全批已出完或都还没跑时给一枚按钮，
     点下去只会得到一句「没有在跑的任务可取消」——那一句话该由界面上的 absence 来说。 */
  const hasActive = c.cells.some(
    (cell) => cell.taskId !== null && isActiveTaskStatus(cell.status),
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={running || stopping || c.cellsLoading}
          onClick={() => void c.runBatch(experiment.id)}
          className="h-auto gap-1.5 rounded-lg px-3 py-1.5"
        >
          <Play data-icon="inline-start" className="size-3" aria-hidden />
          {running ? "正在排队…" : "跑这批"}
        </Button>
        {hasActive ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={running || stopping}
            onClick={() => void c.stopBatch(experiment.id)}
            aria-label={`取消试验「${experiment.name}」还没出完的格子`}
            className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg border px-3 py-1.5"
          >
            <Ban data-icon="inline-start" className="size-3" aria-hidden />
            {stopping ? "取消中…" : "停一批"}
          </Button>
        ) : null}
        <span className="text-ink-fainter text-2xs tabular-nums">
          {completionText(experiment.doneCount, experiment.cellCount)} · 单卡串行
        </span>
      </div>

      {/* 最近一次扇出的那三句话。`queuedText` / `seedText` 是**状态**（这一批怎么了），
          `unmatchedText` 是**告警**（有些值这次没生效）—— 两个 role 分开，读屏才分得出
          哪一句需要用户处理。 */}
      {c.batchSummary ? (
        <div className="flex flex-col gap-1">
          <p
            role="status"
            className="text-ink-faint text-2xs tabular-nums"
          >
            {c.batchSummary.queuedText}
            {c.batchSummary.seedText ? ` · ${c.batchSummary.seedText}` : ""}
          </p>
          {c.batchSummary.unmatchedText ? (
            <p role="alert" className="text-warning-strong text-2xs">
              {c.batchSummary.unmatchedText}
            </p>
          ) : null}
        </div>
      ) : null}

      {c.cellsError ? (
        <p role="alert" className="text-warning-strong text-2xs">
          {c.cellsError}
        </p>
      ) : null}

      {c.cellsLoading ? (
        <p className="text-ink-fainter text-2xs">正在读这一条的格子…</p>
      ) : c.cells.length === 0 ? (
        <EmptyState
          variant="hint"
          /* hint 档只渲染一句（description ?? title），两句合一才不会被截掉一半。 */
          description="这批还没跑过 —— 按上方「跑这批」会把每个座位各排一条出图任务（本机一张一张来）。"
        />
      ) : (
        <ul className="border-border grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {c.cells.map((cell) => (
            <li
              key={cell.id}
              className="border-border bg-subtle rounded-xl border p-2"
            >
              <div className="border-border bg-canvas flex h-24 items-center justify-center overflow-hidden rounded-lg border">
                {cell.imageUrl ? (
                  <ViewableImage
                    src={cell.imageUrl}
                    alt={cellCaption(cell)}
                    label={cellCaption(cell)}
                    className="h-24 w-full object-cover"
                  />
                ) : (
                  /* 没出图的那一格留一个空框就够了：正下方那枚徽章写的就是它为什么
                     还空着（未入队 / 排队中 / 任务已不在）。这里再重复同一句，
                     一块里出现两个「排队中」，读起来反倒像界面坏了。 */
                  <span
                    aria-hidden
                    className="border-border/60 size-8 rounded-full border border-dashed"
                  />
                )}
              </div>
              <p className="text-ink-bright mt-1.5 truncate text-xs font-medium">
                {styleDisplayText(cell.style)}
              </p>
              <p className="text-ink-faint mt-0.5 truncate text-2xs">
                {traitKeyDisplayText(cell.traitKey)}
              </p>
              <div className="mt-1.5">
                <StatusBadge
                  status={cell.status ?? "IDLE"}
                  label={cellStatusText(cell)}
                  dot={false}
                />
              </div>
              <p className="text-ink-fainter mt-1.5 line-clamp-2 text-2xs">
                {cell.prompt}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
