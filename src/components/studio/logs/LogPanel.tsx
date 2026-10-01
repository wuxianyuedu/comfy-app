"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countAfterPage } from "~/lib/page-window";
import { FileText } from "lucide-react";
import {
  dedupeRepeats,
  selectFirstPageWindow,
  selectNewLogCount,
  selectPageLogs,
  selectShouldPinToLatest,
  type LogEntry,
  type LogPanelState,
} from "./log-store";
import { useLogPanel } from "./LogProvider";
import { FILTER_LABELS } from "./LogFilterBar";
import { ORIGIN_TEXT } from "./LogPanelOriginSelect";
import { useLogPanelPin } from "./use-log-panel-pin";
import { LogPanelHeader } from "./LogPanelHeader";
import { LogPanelFooter } from "./LogPanelFooter";
import {
  LOG_ROW_SINGLE,
  layoutRows,
  scrollHeightOf,
  visibleRange,
} from "./log-virtual";
import { useWidePanel } from "~/components/ui/wide-panel";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { modalWidth } from "~/components/ui/dialog-width";
import { useElementBox } from "~/components/ui/use-element-box";
import { LogRow } from "./LogRow";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useFlashState } from "~/components/ui/use-flash-state";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { isCliJsonLine } from "~/lib/log/log-cli-json";

/**
 * 页脚的一行摘要：说清楚「现在看的是哪一段、还有多少」。
 *
 * 搜索词会收窄结果，所以它出现在数字里是**必要**的说明（否则「共 12 条」会被
 * 读成面板一共只有 12 条）；这里用「命中」而不是「匹配」，与计数徽标上的
 * 「筛选命中」是同一个口径。
 */
/** 行位置表 + 视口窗口（纯派生，§17.1：删掉 JSX 也能测）。
 *  可展开的原始输出行（comfy-cli 原文 + JSON 容器）：折叠态强制单行、展开态
 *  用行高常量。判据走共享的 `isCliJsonLine`（便宜，只看前缀与首字符）——
 *  与 `LogRow` 同一口径，两边不会分叉。
 *  量不到视口高度（jsdom 不做布局 / 首帧测量之前）就**整页渲染**：虚拟化是
 *  性能优化，不该变成「内容看不见」的判据——取不到值时说「全都要」最安全，
 *  与改动前的行为一致。jsdom 里的单测正是走这一支。 */
function useVirtualWindow(input: {
  pageLogs: LogEntry[];
  wrap: boolean;
  viewportWidth: number;
  viewportHeight: number;
  scrollTop: number;
  expansionMap: Record<string, boolean>;
}) {
  const {
    pageLogs,
    wrap,
    viewportWidth,
    viewportHeight,
    scrollTop,
    expansionMap,
  } = input;
  const cliJsonIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of pageLogs) {
      if (isCliJsonLine(entry.message)) ids.add(entry.id);
    }
    return ids;
  }, [pageLogs]);
  const expandedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const key of Object.keys(expansionMap)) {
      if (expansionMap[key]) ids.add(key);
    }
    return ids;
  }, [expansionMap]);
  const { rows, totalSize } = useMemo(
    () =>
      layoutRows(pageLogs, wrap, wrap ? viewportWidth : 0, {
        expandedIds,
        singleLineIds: cliJsonIds,
      }),
    [pageLogs, wrap, viewportWidth, expandedIds, cliJsonIds],
  );
  const { height: scrollHeight } = scrollHeightOf(totalSize);
  const rowWindow = useMemo(() => {
    if (viewportHeight <= 0) {
      return { start: 0, end: pageLogs.length, entries: pageLogs };
    }
    const range = visibleRange(rows, scrollTop, viewportHeight);
    return {
      start: range.start,
      end: range.end,
      entries: pageLogs.slice(range.start, range.end),
    };
  }, [rows, scrollTop, viewportHeight, pageLogs]);
  return { rows, scrollHeight, rowWindow };
}
/* 面板的宽度档：默认 6xl —— 行是「时刻 + 级别 + 正文 + 来源」四列，比执行日志
 * 多一列，默认就该更宽；加宽档统一贴视线两边。宽度写 `w-*` 而不是 `max-w-*`
 * 的理由见 `~/components/ui/dialog-width` 的文件头（ISSUE #720：同族的两个
 * max-w 谁赢由 Tailwind 输出顺序决定，加宽按钮因此一直没生效）。 */
const PANEL_WIDTH = modalWidth("w-6xl");

/* 面板关闭时喂给分页/布局 memo 的稳定空数组（引用恒定，memo 据此不随
 * header.filteredLogs 每 2s 变化而重算整页前缀和）。 */
const NO_LOG_ENTRIES: LogEntry[] = [];

export function LogPanel() {
  const {
    filteredLogs,
    filter,
    origin,
    search,
    isOpen,
    counts,
    countsByOrigin,
    page,
    pageSize,
    bootId,
    autoScroll,
    anchorId,
    viewBaselineAfter,
  } = useLogPanel((state) => state.header);
  /* 计数一律看**当前来源**：「全部来源」下是全局数，选了某个来源就是该来源自己
   * 的数——级别按钮与来源下拉共用同一份，两边永远对得上（ISSUE #360）。 */
  const originCounts = countsByOrigin[origin ?? "all"] ?? countsByOrigin.all;
  const revision = useLogPanel((state) => state.revision);
  const droppedTotal = useLogPanel((state) => state.droppedTotal);
  /* 「用户有没有主动要求回到最新」的生成号：它一变，贴底就升级为「一路追到
   * 最新」（见 log-store 的 followResetAt）。视图不自己去猜这件事，否则
   * store 与视图会各存一份贴底状态，出现「面板说不自动滚动、却仍在滚」。 */
  const followResetAt = useLogPanel((state) => state.followResetAt);
  const setFilter = useLogPanel((state) => state.setFilter);
  const setOrigin = useLogPanel((state) => state.setOrigin);
  const setSearch = useLogPanel((state) => state.setSearch);
  const setPage = useLogPanel((state) => state.setPage);
  const setFollowBottom = useLogPanel((state) => state.setFollowBottom);
  const storeJumpToLatest = useLogPanel((state) => state.jumpToLatest);
  const setIsOpen = useLogPanel((state) => state.setIsOpen);
  const clear = useLogPanel((state) => state.clear);
  const copyAllRaw = useLogPanel((state) => state.copyAll);
  const download = useLogPanel((state) => state.download);

  /* 「复制 / 下载」两枚工具按钮的成败反馈（规范 16 §16.2.4.43）：此前这一段
   * 完全没有出口 —— `copyAll` 把剪贴板结果吞掉，按钮上也没有任何状态，于是
   * 「复制失败」在这块界面上不可见（用户以为拿到了，贴出来是空的）。
   * 成功亮一下（`useFlashState`）、失败原地换文案并说清怎么自救。 */
  const copyOutcome = useFlashState(1500);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyAll = useCopyFeedback({
    onSuccess: () => {
      setCopyFailed(false);
      copyOutcome.flash();
    },
    onFailure: () => setCopyFailed(true),
  });

  /* 「复制全部」的文本要到点击那一刻才从 store 取（当前筛选 × 所有页），
   * 所以走出口的**现算**形态。 */
  const copyAllAction = useCallback(
    () => copyAll(() => copyAllRaw()),
    [copyAll, copyAllRaw],
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  /* 滚动视口的**元素本身**进 state：下面「量视口」的 effect 必须等到这个元素
   * 真的挂上才量。改成弹窗基元（`ui/dialog`）之后，面板内容经 Portal 渲染，
   * 挂载比本组件晚一个提交 —— 只按 `[isOpen]` 触发的话，唯一的量测会发生在
   * ref 还是 null 的时候，之后再也没有第二次，虚拟化于是静默退化成「整页渲染」
   *（jsdom 里两条分支都渲染全部行，肉眼看不出来；只有量 DOM 节点数才发现）。
   * 依赖「元素出现了没有」而不是「面板开了没有」，量测才与挂载方式无关。 */
  /* 视口量测收在 `~/components/ui/use-element-box`（规范 16 §16.2.4.41）：
   * 此前是本文件自持的 `ResizeObserver` + 手写等值判断 —— 与
   * `WorkflowLibraryCanvas` 的底图量测各写一遍。
   *
   * ⚠️ **量测必须晚于元素挂载**：改成弹窗基元（`ui/dialog`）之后，面板内容经
   * Portal 渲染、挂载比本组件晚一个提交 —— 按 `[isOpen]` 触发的话，那次量测
   * 会发生在 ref 还是 `null` 的时候，之后再也没有第二次，虚拟化于是静默退化成
   * 「整页渲染」（jsdom 里两条分支都渲染全部行，肉眼看不出来；只有量 DOM
   * 节点数才发现）。出口的**回调 ref** 恰好把「元素出现了没有」作为触发点，
   * 量测因此与挂载方式无关。 */
  const [bodyBoxRef, bodyBox] = useElementBox();
  /* 贴底基线（= 用户已看过的最新一条在**页面里的序号**）。
   *
   * 面板贴着底看时只滚到这里：新日志在下面累积，不再每两秒把内容整体上移一次
   * ——那正是「刚选中一行就被刷新冲掉」的直接原因（ISSUE #262 复审）。
   * 基线在「打开面板 / 用户滚回底部 / 换页」时重取，用户点「回到最新」后
   * followResetAt 变化，贴底升级为一路追到最新。 */
  const [wrap, setWrap] = useState(true);
  /* comfy-cli 原始输出行的展开集合：状态走唯一出口 `useExpansionSet`
   * （规范 16 §16.2.4.17），高度由 `log-virtual` 按 **id** 给常量（展开态
   * `LOG_ROW_EXPANDED`、折叠态强制单行）。状态挂面板而不是行内，行滚出窗口
   * 卸载后回来仍是同一行、同一展开态。 */
  const expansion = useExpansionSet();
  /* 直接取 `toggle` 交给行：它的引用稳定（`useExpansionSet` 内 `useCallback([])`），
   * 因此 `LogRow` 的 memo 不会被每次展开 / 收起破坏。 */
  /* 加宽档与它的记忆收在 `~/components/ui/wide-panel`（规范 16 §16.2.4.18）：
   * 此前三个日志面板各写一份 `useState`，且**都没有持久化** ——
   * 用户加宽后关掉再打开又回到窄档。 */
  const panel = useWidePanel("app-log", PANEL_WIDTH);

  /* ── 虚拟窗口（ISSUE #609 八审：「切到 1000+ 的页签有明显卡顿」）────────
   *
   * 满页 2000 行一次性挂进 DOM 时，节点数约 1.5 万（每行还有若干分片 span），
   * 切页那一刻的布局成本就是用户感知到的卡顿。规范 02 §2.6 要求大列表虚拟
   * 滚动，这里只渲染视口内的几十行。
   *
   * 三个状态驱动的都是「**怎么算**」而不是「渲染什么」，因此都进 ref/state
   * 的轻量档：
   *   - `viewport`：滚动视口高度与可视宽度（软换行的容量用它算）；
   *   - `scrollTop`：滚动位置（`onScroll` 里直接读 `el.scrollTop`）；
   *   - 行位置表由 `pageLogs` + `wrap` 推出，随它们一起 memo。
   *
   * 为什么把 `scrollTop` 放进 state 而不是只读 ref：窗口区间是渲染结果的一部分
   * （不是副作用），放进 ref 会让「滚动 → 不重渲染 → 内容不更新」。每帧一次
   * `setState` 在 React 18 的批处理下只重渲染**列表容器**（行本身是 memo 的），
   * 实测远低于一帧预算。
   */
  /* 视口尺寸（高度 + 可视宽度）由 `useElementBox` 给；这里只保留派生的
   * 便捷视图，未量到时保持与收口前一致的 0（下面的窗口逻辑据此走整页渲染）。 */
  const viewport = {
    height: bodyBox?.clientHeight ?? 0,
    width: bodyBox?.clientWidth ?? 0,
  };
  const [scrollTop, setScrollTop] = useState(0);

  /* 关闭时把重活（分页切片 + 整页前缀和 + 折行估高）从数据流上摘掉：
   * 面板不可见却仍随 header.filteredLogs 每 2s 重算一次 2000 行是不必要的 CPU 税。
   * viewLogs 引用恒定（空数组常量），下面几个 memo 因此在关闭态整体短路。 */
  const viewLogs = isOpen ? filteredLogs : NO_LOG_ENTRIES;

  /* 分页在**过滤后的时间线**上做（时间倒序，第 1 页最新）。页码越界时钳回，
   * 并把 store 里的 page 一并归位，避免「看着第 1 页、state 里却是第 9 页」。 */
  const {
    entries: rawPageLogs,
    page: safePage,
    totalPages,
  } = useMemo(
    () => selectPageLogs(viewLogs, page, pageSize),
    [viewLogs, page, pageSize],
  );

  /* 第 1 页用**锚定**窗口（见 store 的 anchorId）：不锚定时窗口整体前移，每来一条
   * 新日志就重建一次首行节点——用户刚框住的文本随节点被卸载，选区当场消失
   * （「刚选择就刷新把我的选择弄没了」）。锚定后窗口原地不动，新行列在它之后；
   * 「后面还有多少条新的」由 `truncatedFromEnd` 直接给出（不再靠长度差，封顶时
   * 长度差恒为 0）。
   *
   * 其余页（历史页）本来就与「最新」无关，继续用固定窗口。 */
  const anchored = useMemo(
    () =>
      safePage === 1
        ? selectFirstPageWindow(viewLogs, anchorId, pageSize)
        : null,
    [safePage, viewLogs, anchorId, pageSize],
  );
  const visibleLogs = anchored ? anchored.entries : rawPageLogs;
  /* 当前窗口之后还有多少条更新的日志（锚定窗口直接给出；历史页则按页码算）。 */
  const unseenAfterView = anchored
    ? anchored.truncatedFromEnd
    : countAfterPage(viewLogs.length, safePage, pageSize);

  /* 连续重复行折叠只影响显示（见 log-store 的 dedupeRepeats），不改时间线。 */
  const pageLogs = useMemo(() => dedupeRepeats(visibleLogs), [visibleLogs]);

  /* ── 行位置表 + 视口窗口（纯派生，沉在 useVirtualWindow）─────────────
   * 位置表按**整页**算（单调前缀和）：`start[i]` 必须对得上前面所有行高之和，
   * 否则 `translateY` 与滚动条会各说各话。2000 行的乘法远低于一帧预算。
   * `viewport.width` 为 0（首帧未量到 / jsdom 不做布局）时 `layoutRows` 只按
   * 显式换行估高——宁可少估，也不瞎估。 */
  const { rows, scrollHeight, rowWindow } = useVirtualWindow({
    pageLogs,
    wrap,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    scrollTop,
    expansionMap: expansion.map,
  });

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage, setPage]);

  /* 换页时把滚动位置收回头部，并同步 `scrollTop` 状态。
   *
   * 虚拟化之前不需要这一步：整页都在 DOM 里，浏览器自己会把超出的 `scrollTop`
   * 钳回范围内。现在「渲染哪一段」由 `scrollTop` **算**出来，若它还停在上一页
   * 的纵深上（比如第 2 页滚到 30000px、翻到只有 8 行的第 3 页），算出的窗口会
   * 一路滑到末尾，用户看到的是「翻页后内容跑到一半、顶部空着」。
   *
   * `safePage` 是钳过边界的真实页码（见 selectPageLogs），据此判定「真的换了页」。 */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setScrollTop(0);
  }, [safePage]);

  /* 视口尺寸（滚动视口高度 + 可供正文使用的宽度）。
   *
   * 高度决定**渲染几行**；宽度决定**软换行估几行**（见 log-virtual 的
   * `countLines`）。两者都必须重新量：面板可以加宽（标题栏的「加宽」按钮）、
   * 窗口可以缩放、正文列还会随滚动条出现而变窄。
   *
   * 用 ResizeObserver 而不是 window 的 resize：加宽按钮改的是元素宽度，
   * 窗口尺寸一点没变。观测不到（jsdom / 老浏览器）时不额外退化——量出来恒为
   * 0 已经会让下面的窗口逻辑走「整页渲染」那一支，行为与改动前一致。 */

  /* 贴底只追到「基线」——沉在 use-log-panel-pin（ISSUE #262 复审）。
   * refs（基线 / 上次落位 / 上次写入的 scrollTop）随 hook 走。 */
  const { onScroll } = useLogPanelPin({
    isOpen,
    autoScroll,
    safePage,
    followResetAt,
    revision,
    visibleLogs,
    rows,
    bodyRef,
    setScrollTop,
    setFollowBottom,
  });
  const shouldPin = selectShouldPinToLatest(safePage, autoScroll);
  const newLogCount = useLogPanel(
    useCallback(
      (state: LogPanelState) =>
        selectNewLogCount({
          unseenAfterView,
          baselineAfterView: viewBaselineAfter,
          page: state.page,
          autoScroll,
        }),
      [autoScroll, unseenAfterView, viewBaselineAfter],
    ),
  );

  const jumpToLatest = () => {
    storeJumpToLatest();
    setPage(1);
  };

  const total = filteredLogs.length;
  /* 「现在复制/下载的是哪一类」——与页脚的筛选摘要同口径，导出前一眼可见。 */
  const scopeLabel = [
    ORIGIN_TEXT[origin ?? "all"],
    FILTER_LABELS.find((item) => item.value === filter)?.label ?? "全部",
    search.trim() ? `搜索「${search.trim()}」` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!isOpen) return null;

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给 `ui/dialog`：此前这里**既没接
     Esc、也没有遮罩点击关闭** —— 面板只能靠外壳的开关按钮关掉。层级仍由刻度表
     给出（`ui/dialog` 的遮罩取 `Z.modal`），面板内的弹层继续取 `Z.popup`
     （§16.2.5 的 `popup > modal` 判据不变）。 */
  return (
    /* 非模态：base-ui 的模态弹窗会把 portal 以外的整页设 inert/aria-hidden，令窗口标题行
     * 里的「应用页签」tablist 在面板打开时从无障碍树消失（ISSUE #310 的 e2e 断言页签在
     * 面板打开时仍可见可点，仅靠 z-index 只保住了鼠标命中、没保住 a11y 可见）。日志面板
     * 本就是「开着还能继续用页签」的非阻塞工具窗，用非模态正好。关闭路径不变（Esc +
     * onOpenChange + Ctrl+Shift+L + 关闭按钮）。 */
    <Dialog
      open
      modal={false}
      onOpenChange={(next) => !next && setIsOpen(false)}
    >
      <DialogContent
        aria-label="应用日志"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName={panel.widthClass}
      >
        <div
          className={`border-border-strong bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/60 ${panel.widthClass}`}
        >
          <LogPanelHeader
            originCounts={originCounts}
            countsByOrigin={countsByOrigin}
            origin={origin}
            setOrigin={setOrigin}
            wrap={wrap}
            setWrap={setWrap}
            copyFailed={copyFailed}
            copyDone={copyOutcome.on}
            copyAllAction={copyAllAction}
            scopeLabel={scopeLabel}
            total={total}
            download={download}
            clear={clear}
            panel={panel}
            setIsOpen={setIsOpen}
          />

          {/* Body */}
          <div
            ref={(el) => {
              bodyRef.current = el;
              bodyBoxRef(el);
              /* 量到之后把「滚动位置」一并同步一次：`useElementBox` 的观察者
               * 回调里 `scrollTop` 可能已经变了（面板加宽会让换行数变化、
               * 进而改变滚动范围），而出口只管盒子、不管滚动。这里在**回调
               * ref**（外部系统通知）里同步，而不是在 effect 体里 setState。 */
              setScrollTop(el?.scrollTop ?? 0);
            }}
            onScroll={onScroll}
            className="custom-scrollbar bg-canvas-deep/60 flex-1 overflow-y-auto"
          >
            {pageLogs.length === 0 ? (
              <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
                <FileText size={32} strokeWidth={1.5} className="opacity-30" />
                {total === 0 ? "暂无匹配的日志" : "本页无内容"}
              </div>
            ) : (
              /* 虚拟窗口：外层撑出**估算总高**（滚动条长度与真实内容一致），
               内层 `translateY` 到当前窗口的起点——只挂视口内的行。 */
              <div
                style={{ height: `${scrollHeight}px` }}
                className="relative w-full"
              >
                <div
                  style={{
                    transform: `translateY(${rows[rowWindow.start]?.start ?? 0}px)`,
                  }}
                  className="absolute top-0 left-0 w-full"
                >
                  {/* `data-log-index`：这一行在**整页**里的绝对序号（不是它在
                    当前窗口里的第几个）。它同时是测试量「渲染了哪一段」的落点
                    （e2e 与 jsdom 单测都按它断言窗口位置），因此序号口径必须是
                    页内绝对的——窗口一变，同一个序号还得指着同一行。 */}
                  {rowWindow.entries.map((entry, offset) => {
                    const index = rowWindow.start + offset;
                    return (
                      <div key={entry.id} data-log-index={index}>
                        <LogRow
                          entry={entry}
                          wrap={wrap}
                          keyword={search}
                          expanded={expansion.isExpanded(entry.id)}
                          onToggleExpand={expansion.toggle}
                          /* 显式高度 = 估算高度：两者不同口径时误差会累积，
                           滚动位置与内容就错开了（见 log-virtual 的常量）。 */
                          style={{
                            height: `${rows[index]?.size ?? LOG_ROW_SINGLE}px`,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer：分页 + 「回到最新」出口。
            时间线有内存上限（LOG_STORE_MAX=5000）：更旧的会被折叠，droppedTotal
            累计并在下方提示「更早 N 条已折叠」，完整历史仍在磁盘日志文件里。
            同时显示多少条由每页 ≤ LOG_PAGE_SIZE 兜住。 */}
          <LogPanelFooter
            safePage={safePage}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            totalAll={counts.all}
            search={search}
            droppedTotal={droppedTotal}
            bootId={bootId}
            shouldPin={shouldPin}
            newLogCount={newLogCount}
            jumpToLatest={jumpToLatest}
            setPage={setPage}
            origin={origin}
            setOrigin={setOrigin}
            filter={filter}
            setFilter={setFilter}
            setSearch={setSearch}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
