"use client";

import { ChevronDown, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/time-format";

import { completionText, matrixFormulaText } from "./style-lab-config";
import { StyleLabCells } from "./StyleLabCells";
import type { StyleLabController } from "./hooks/use-style-lab";

/**
 * 风格实验室 · 试验列表（第③层的一部分，纯视图）。
 *
 * 与新建表单分开成两个视图，同样是为「新组件 ≤200 行」与「按职责拆」。软删走
 * 「两步确认」：第一次点只把目标 id 记进 controller，第二次点才真发请求 —— 删的
 * 是这一屏记录的可见性，不该一次点击就落地（规范 10 §10.5：破坏性动作要有反悔位）。
 */
export function StyleLabList({ c }: { c: StyleLabController }) {
  if (c.items.length === 0) {
    return (
      <EmptyState
        variant="hint"
        /* hint 档只渲染一句（description ?? title）：传两个会让标题静默消失，
           所以这里把「还没有」与「下一步做什么」写成同一句。 */
        description="还没有登记过试验 —— 在下方新建一条，记下「哪套风格 × 哪些特征」，再展开它按格跑这批。"
      />
    );
  }

  return (
    <ul className="border-border bg-card overflow-hidden rounded-2xl border">
      {c.items.map((item) => {
        const confirmed = c.deleteTargetId === item.id;
        const expanded = c.expandedId === item.id;
        const status =
          item.cellCount > 0 && item.doneCount >= item.cellCount
            ? "DONE"
            : "DRAFT";
        return (
          <li
            key={item.id}
            className="border-border border-b px-4 py-3 last:border-b-0"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-ink-bright min-w-0 flex-1 truncate text-sm font-semibold">
                {item.name}
              </h3>
              <StatusBadge
                status={status}
                label={status === "DONE" ? "已出图" : "待生成"}
              />
              <Button
                variant="ghost"
                size="xs"
                onClick={() => (expanded ? c.collapse() : c.expand(item.id))}
                aria-expanded={expanded}
                /* 收起时那块根本不存在，`aria-controls` 指着一个空 id 等于给读屏
                   一个假引用 —— 只在展开时给。 */
                aria-controls={expanded ? `style-lab-cells-${item.id}` : undefined}
                aria-label={`${expanded ? "收起" : "展开"}试验「${item.name}」的格子`}
                className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1 rounded-lg px-2 py-1"
              >
                <ChevronDown
                  data-icon="inline-start"
                  className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                />
                {expanded ? "收起" : "看格子"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={c.deletingId === item.id}
                onClick={() => (confirmed ? void c.confirmDelete() : c.askDelete(item.id))}
                aria-label={`删除试验「${item.name}」`}
                className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1 rounded-lg px-2 py-1"
              >
                <Trash2 data-icon="inline-start" className="size-3" aria-hidden />
                {confirmed ? "确认删除" : "删除"}
              </Button>
            </div>
            {confirmed ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-ink-fainter text-2xs">
                  删除后这一条不再显示（数据本身保留）。
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={c.cancelDelete}
                  className="h-auto"
                >
                  取消
                </Button>
              </div>
            ) : (
              <p className="text-ink-faint mt-1 text-xs">
                {matrixFormulaText(item.styles, item.traits)} ·{" "}
                {completionText(item.doneCount, item.cellCount)} ·{" "}
                {formatDate(item.createdAt)}
              </p>
            )}
            {expanded ? (
              <div id={`style-lab-cells-${item.id}`}>
                <StyleLabCells c={c} experiment={item} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
