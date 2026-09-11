"use client";

/* 工作流库画布节点里的「对外参数映射」—— 直接把作者在编辑器里看到的五张
 * 映射卡片（宽高比 / 像素量 / 提示词 / 倍数 / seed）搬到库内的画布节点上，
 * 并显示它连到哪个节点端口。
 *
 * 只读（视图层，规范 §17.2 第③层）：映射的作者入口是工作流编辑器的画布，
 * 库里是消费视角 —— 同一份 `paramMap.source` 事实源，两处展示同源，避免
 * 「库里的数字与编辑器里连的线对不上」。 */

import { Lightbulb, Unplug } from "lucide-react";

import type { ParamEntry } from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "./workflow-param-mapping-ui";

export interface MappingSummaryRow {
  entry: ParamEntry;
  /** 该参数当前连到的节点端口名（未连线为 null）。 */
  targetName: string | null;
  /** 作者手工改过连线（默认连线状态之外的线）。 */
  manual: boolean;
}

export function WorkflowParamMappingSummary({ rows }: { rows: MappingSummaryRow[] }) {
  /* 一条映射都没有（参数未被暴露 / 全被断开）时整段不渲染，库里的卡片
   *  与旧的「画布样式预览」逐像素一致。 */
  if (rows.length === 0) return null;

  return (
    <div className="border-t border-(--color-border-subtle) px-[14px] py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium text-(--color-ink-faint)">
        <Lightbulb size={10} />
        <span>对外参数映射</span>
        <span className="rounded-full bg-(--color-surface-2) px-1.5 text-[9.5px] text-(--color-ink-fainter)">
          {rows.length}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map(({ entry, targetName, manual }) => {
          const style = paramClassStyle(entry.cls);
          const connected = !!targetName;
          return (
            <div
              key={entry.id}
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-(--color-border-subtle) bg-(--color-surface-1) px-1.5 py-1"
              title={`${entry.nodeTitle || entry.nodeId} · ${style.label}`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: style.color, boxShadow: `0 0 6px ${style.color}` }}
              />
              <span className="max-w-[90px] shrink-0 truncate text-[10.5px] font-medium text-(--color-ink-strong)">
                {entry.label}
              </span>
              <span className="shrink-0 text-[10px] text-(--color-ink-fainter)">→</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-(--color-ink-soft)">
                {connected ? targetName : "未连线"}
              </span>
              {/* 三态互斥：**先**判有没有连上，「断开」不能被「手工」盖掉
                  —— 作者显式断开的线也是手工改过的，但它当前的状态是「没连」。 */}
              <span
                className={`shrink-0 rounded px-1 py-px text-[9.5px] ${
                  !connected
                    ? "bg-(--color-surface-2) text-(--color-ink-fainter)"
                    : manual
                      ? "bg-amber-500/15 text-amber-600"
                      : "bg-emerald-500/12 text-emerald-600"
                }`}
              >
                {!connected ? "断开" : manual ? "手工" : "自动"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 flex items-start gap-1 text-[9.5px] leading-relaxed text-(--color-ink-fainter)">
        <Unplug size={9} className="mt-0.5 shrink-0" />
        <span>
          「自动」= 未改过的默认连线状态。要改连线请打开编辑器，
          在画布节点上把对外参数拖到目标端口。
        </span>
      </p>
    </div>
  );
}
