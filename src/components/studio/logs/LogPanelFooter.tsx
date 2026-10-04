"use client";

/**
 * LogPanel 的页脚拆分件（§17.12 视图二次拆分：只动 JSX 物理位置，不动行为）。
 * 分页 + 「回到最新」出口 + 「正在看什么」筛选摘要（点任意一项即去掉该层）。
 * 时间线有内存上限（LOG_STORE_MAX=5000）：更旧的会被折叠，droppedTotal
 * 累计并在下方提示，完整历史仍在磁盘日志文件里。
 */
import { ArrowDownToLine, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { FILTER_LABELS } from "./LogFilterBar";
import { ORIGIN_TEXT } from "./LogPanelOriginSelect";
import type { LogFilter, LogOriginFilter } from "./log-types";

function pageSummary(
  page: number,
  totalPages: number,
  pageSize: number,
  total: number,
  all: number,
  search: string,
): string {
  if (total === 0) return search.trim() ? "无筛选命中的日志" : "无匹配日志";
  const head = `第 ${page} / ${totalPages} 页 · 每页最多 ${pageSize} 条`;
  const tail = `${search.trim() ? "筛选命中" : "匹配"} ${total} 条 · 面板共保留 ${all} 条`;
  return `${head} · ${tail}`;
}

export function LogPanelFooter(input: {
  safePage: number;
  totalPages: number;
  pageSize: number;
  total: number;
  totalAll: number;
  search: string;
  droppedTotal: number;
  bootId: string | null;
  shouldPin: boolean;
  newLogCount: number;
  jumpToLatest: () => void;
  setPage: (page: number) => void;
  origin: LogOriginFilter | null;
  setOrigin: (value: LogOriginFilter) => void;
  filter: LogFilter;
  setFilter: (value: LogFilter) => void;
  setSearch: (value: string) => void;
}) {
  const {
    safePage,
    totalPages,
    pageSize,
    total,
    totalAll,
    search,
    droppedTotal,
    bootId,
    shouldPin,
    newLogCount,
    jumpToLatest,
    setPage,
    origin,
    setOrigin,
    filter,
    setFilter,
    setSearch,
  } = input;

  return (
    <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
      <span className="flex items-center gap-2">
        <span>
          {pageSummary(safePage, totalPages, pageSize, total, totalAll, search)}
        </span>
        {droppedTotal > 0 && (
          <span
            className="text-ink-fainter shrink-0"
            title={`内存时间线已折叠更早的 ${droppedTotal} 条（完整历史见磁盘日志文件）`}
          >
            · 更早 {droppedTotal} 条已折叠
          </span>
        )}
        {/* 服务端进程标识：用户报障时能说清「日志来自哪个应用服务进程」，
          也让面板在服务真重启后能自证（时间线已重置）。 */}
        {bootId && (
          <span
            className="border-border-strong text-ink-muted text-2xs shrink-0 rounded border px-1.5 py-px"
            title={`应用服务进程标识：${bootId}（重启后会变化，面板据此重置时间线）`}
          >
            服务 {bootId.split(":").slice(-2).join(":")}
          </span>
        )}
      </span>
      <span className="flex items-center gap-3">
        {shouldPin && (
          <Button variant="primary-solid" size="xs" onClick={jumpToLatest}>
            <ArrowDownToLine size={12} />
            {newLogCount > 0
              ? `有 ${newLogCount} 条新的日志 · 回到最新`
              : "回到最新"}
          </Button>
        )}
        <span className="flex items-center gap-1">
          <Hint label="更新的一页" accessibleName wrap>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage <= 1}
              className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
            >
              <ChevronLeft data-icon="inline-start" size={14} />
            </Button>
          </Hint>
          {/* 当前正看的是哪一段（来源 / 级别 / 搜索词），点任意一项即去掉
            那一层筛选。此处用按钮而不是纯文本：页脚是「说出来我在看什么」
            的位置，回滚动作本来就该在这儿，不必让用户跑回顶部找。 */}
          <span className="text-ink-soft flex items-center gap-1">
            <Hint
              label={origin && origin !== "all" ? "去掉来源筛选" : undefined}
              wrap
            >
              <Button
                variant="ghost"
                size="xs"
                data-testid="logpanel-origin-chip"
                onClick={() => setOrigin("all")}
                disabled={!origin || origin === "all"}
                className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md tabular-nums disabled:cursor-default"
              >
                {ORIGIN_TEXT[origin ?? "all"]}
              </Button>
            </Hint>
            <Hint label={filter !== "all" ? "去掉级别筛选" : undefined} wrap>
              <Button
                variant="ghost"
                size="xs"
                data-testid="logpanel-level-chip"
                onClick={() => setFilter("all")}
                disabled={filter === "all"}
                className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md disabled:cursor-default"
              >
                {FILTER_LABELS.find((item) => item.value === filter)?.label}
              </Button>
            </Hint>
            {search.trim() && (
              <Hint label="清空搜索">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSearch("")}
                  className="hover:bg-subtle hover:text-ink max-w-40 truncate rounded-md"
                >
                  {`搜索「${search.trim()}」`}
                </Button>
              </Hint>
            )}
          </span>
          <Hint label="更早的一页" accessibleName wrap>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
            >
              <ChevronRight data-icon="inline-start" size={14} />
            </Button>
          </Hint>
        </span>
      </span>
    </div>
  );
}
