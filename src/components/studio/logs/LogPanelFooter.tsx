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
import { Pagination, PaginationContent, PaginationItem } from "~/components/ui/pagination";
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
  if (total === 0) {
    return search.trim() ? "无筛选命中的日志" : "无匹配日志";
  }
  const head = `第 ${page} / ${totalPages} 页 · 每页最多 ${pageSize} 条`;
  const tail = `${search.trim() ? "筛选命中" : "匹配"} ${total} 条 · 面板共保留 ${all} 条`;
  return `${head} · ${tail}`;
}

export function LogPanelFooter(input: {
  bootId: string | null;
  droppedTotal: number;
  filter: LogFilter;
  jumpToLatest: () => void;
  newLogCount: number;
  origin: LogOriginFilter | null;
  pageSize: number;
  safePage: number;
  search: string;
  setFilter: (value: LogFilter) => void;
  setOrigin: (value: LogOriginFilter) => void;
  setPage: (page: number) => void;
  setSearch: (value: string) => void;
  shouldPin: boolean;
  total: number;
  totalAll: number;
  totalPages: number;
}) {
  const {
    bootId,
    droppedTotal,
    filter,
    jumpToLatest,
    newLogCount,
    origin,
    pageSize,
    safePage,
    search,
    setFilter,
    setOrigin,
    setPage,
    setSearch,
    shouldPin,
    total,
    totalAll,
    totalPages,
  } = input;

  return (
    <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-xs">
      <span className="flex items-center gap-2">
        <span>{pageSummary(safePage, totalPages, pageSize, total, totalAll, search)}</span>
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
          <Button onClick={jumpToLatest} size="xs" variant="primary-solid">
            <ArrowDownToLine size={12} />
            {newLogCount > 0 ? `有 ${newLogCount} 条新的日志 · 回到最新` : "回到最新"}
          </Button>
        )}
        {/* 翻页控件走 `ui/pagination`（规范 16 §16.2.4.6 / §16.2.4.72 的零引用
          基元复查）：`Pagination` / `PaginationContent` / `PaginationItem` 给的是
          `nav[aria-label="pagination"]` + `ol`/`li` 的层级语义与统一排布契约。
          此前这里是一层裸 `span` 串两个按钮 —— 读屏器读到的是一串孤立按钮，
          没有任何「这是一组分页控件」的说法。
          **只借结构、不借 `PaginationLink`**：那个是带 `href` 的页链接，而本
          面板的页码是**受控状态**（当前页归 `useLogStore`），不是地址。 */}
        <Pagination className="w-auto flex-1 justify-end">
          <PaginationContent className="gap-1">
            <PaginationItem>
              <Hint accessibleName label="更新的一页" wrap>
                <Button
                  className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ChevronLeft data-icon="inline-start" size={14} />
                </Button>
              </Hint>
            </PaginationItem>
            {/* 当前正看的是哪一段（来源 / 级别 / 搜索词），点任意一项即去掉
            那一层筛选。此处用按钮而不是纯文本：页脚是「说出来我在看什么」
            的位置，回滚动作本来就该在这儿，不必让用户跑回顶部找。 */}
            <PaginationItem className="text-ink-soft flex items-center gap-1">
              <Hint label={origin && origin !== "all" ? "去掉来源筛选" : undefined} wrap>
                <Button
                  className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md tabular-nums disabled:cursor-default"
                  data-testid="logpanel-origin-chip"
                  disabled={!origin || origin === "all"}
                  onClick={() => setOrigin("all")}
                  size="xs"
                  variant="ghost"
                >
                  {ORIGIN_TEXT[origin ?? "all"]}
                </Button>
              </Hint>
              <Hint label={filter !== "all" ? "去掉级别筛选" : undefined} wrap>
                <Button
                  className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md disabled:cursor-default"
                  data-testid="logpanel-level-chip"
                  disabled={filter === "all"}
                  onClick={() => setFilter("all")}
                  size="xs"
                  variant="ghost"
                >
                  {FILTER_LABELS.find((item) => item.value === filter)?.label}
                </Button>
              </Hint>
              {search.trim() && (
                <Hint label="清空搜索">
                  <Button
                    className="hover:bg-subtle hover:text-ink max-w-40 truncate rounded-md"
                    onClick={() => setSearch("")}
                    size="xs"
                    variant="ghost"
                  >
                    {`搜索「${search.trim()}」`}
                  </Button>
                </Hint>
              )}
            </PaginationItem>
            <PaginationItem>
              <Hint accessibleName label="更早的一页" wrap>
                <Button
                  className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ChevronRight data-icon="inline-start" size={14} />
                </Button>
              </Hint>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </span>
    </div>
  );
}
