"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countAfterPage } from "~/lib/page-window";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  dedupeRepeats,
  selectFirstPageWindow,
  selectNewLogCount,
  selectPageLogs,
  selectShouldPinToLatest,
  type LogEntry,
  type LogPanelState,
} from "./log-store";
import { Button } from "~/components/ui/button";
import { useLogPanel } from "./LogProvider";
import { SaveExportButton } from "./SaveExportButton";
import { FILTER_LABELS, LogFilterBar } from "./LogFilterBar";
import { OriginSelect, ORIGIN_TEXT } from "./LogPanelOriginSelect";
import {
  LOG_ROW_SINGLE,
  layoutRows,
  pinPlan,
  pinScrollTop,
  scrollHeightOf,
  visibleRange,
} from "./log-virtual";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { modalWidth } from "~/components/ui/dialog-width";
import { useWidePanel, WidePanelToggle } from "~/components/ui/wide-panel";
import { useElementBox } from "~/components/ui/use-element-box";
import { FILTER_SELECTED_STYLES, selectionInsideLogs } from "./log-row-style";
import { LogRow } from "./LogRow";
import {
  copyFailureText,
  useCopyFeedback,
} from "~/components/ui/use-copy-feedback";
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
/* 面板的宽度档：默认 6xl —— 行是「时刻 + 级别 + 正文 + 来源」四列，比执行日志
 * 多一列，默认就该更宽；加宽档统一贴视线两边。宽度写 `w-*` 而不是 `max-w-*`
 * 的理由见 `~/components/ui/dialog-width` 的文件头（ISSUE #720：同族的两个
 * max-w 谁赢由 Tailwind 输出顺序决定，加宽按钮因此一直没生效）。 */
const PANEL_WIDTH = modalWidth("w-6xl");

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
  const baselineRef = useRef(0);
  /* 上一次贴底落在页面里的序号；仅用于「有新增才滚」的比较（不参与可见输出）。 */
  const appliedRef = useRef(-1);
  /* 上一次贴底**自己**写入的 `scrollTop`：据此判定「用户有没有接管滚动」
   * （见 `log-virtual` 的 `pinShouldYield`），是记账值，不进 state。 */
  const appliedTopRef = useRef(0);
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

  /* ── 行位置表 + 视口窗口 ────────────────────────────────────────────
   *
   * 位置表按**整页**算（单调前缀和）：`start[i]` 必须对得上前面所有行高之和，
   * 否则 `translateY` 与滚动条会各说各话。2000 行的乘法远低于一帧预算。
   *
   * `viewport.width` 为 0（首帧未量到 / jsdom 不做布局）时 `layoutRows` 只按
   * 显式换行估高——宁可少估，也不瞎估。 */
  /* 可展开的原始输出行（comfy-cli 原文 + JSON 容器）：折叠态强制单行、展开态
   * 用行高常量。判据走共享的 `isCliJsonLine`（便宜，只看前缀与首字符）——
   * 与 `LogRow` 同一口径，两边不会分叉。 */
  const cliJsonIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of pageLogs) {
      if (isCliJsonLine(entry.message)) ids.add(entry.id);
    }
    return ids;
  }, [pageLogs]);
  const expandedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const key of Object.keys(expansion.map)) {
      if (expansion.map[key]) ids.add(key);
    }
    return ids;
  }, [expansion.map]);

  const { rows, totalSize } = useMemo(
    () =>
      layoutRows(pageLogs, wrap, wrap ? viewport.width : 0, {
        expandedIds,
        singleLineIds: cliJsonIds,
      }),
    [pageLogs, wrap, viewport.width, expandedIds, cliJsonIds],
  );
  const { height: scrollHeight } = scrollHeightOf(totalSize);
  /* 量不到视口高度（jsdom 不做布局 / 首帧测量之前）就**整页渲染**：虚拟化是
   * 性能优化，不该变成「内容看不见」的判据——取不到值时说「全都要」最安全，
   * 与改动前的行为一致。jsdom 里的单测正是走这一支。 */
  const rowWindow = useMemo(() => {
    if (viewport.height <= 0) {
      return { start: 0, end: pageLogs.length, entries: pageLogs };
    }
    const range = visibleRange(rows, scrollTop, viewport.height);
    return {
      start: range.start,
      end: range.end,
      entries: pageLogs.slice(range.start, range.end),
    };
  }, [rows, scrollTop, viewport.height, pageLogs]);

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

  /* ── 贴底：只追到「基线」，不再追着最新跑（ISSUE #262 复审）────────────
   *
   * 旧行为是「时间线一变就 scrollTop = scrollHeight」，而它**每两秒就成立一次**
   * （几乎每轮轮询都有新行），于是内容每隔两秒整体上移一次，用户刚框住的文本立刻
   * 被滚动冲掉。现在只在**贴着底**时把「已读水位」（基线）钉住，新行在下面累积，
   * 腾出的空间交给页脚的「有 N 条新的日志 · 回到最新」。任何一层成立都不动滚动
   * 位置：不在第 1 页（在看历史）/ 用户没贴着底（自己滚走了）/ 正在框选日志文本。
   *
   * 位置怎么算是纯逻辑（见 `log-virtual` 的贴底一组）；这里只读写 ref，不用 state
   * ——用 state 承载会让贴底本身触发重渲染，落进「滚动 → 重渲染 → 再滚动」的循环。
   */
  useEffect(() => {
    if (!isOpen) {
      baselineRef.current = 0;
      appliedRef.current = -1;
      return;
    }
    if (safePage !== 1 || !autoScroll) return;
    const el = bodyRef.current;
    if (!el) return;

    /* 用户点过「回到最新」→ 不再受基线约束，一路追到最新一页的底部。 */
    if (followResetAt > 0) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    /* **正在框选就什么都别做**：拖动过程中浏览器会随滚动改锚点，滚动会打断框选
     * ——这正是「刚选中就被刷新弄没」的最后一环（前两环在 store：贴底基线）。 */
    if (selectionInsideLogs(currentSelection())) return;

    /* 目标行 + 「用户有没有接管滚动」的判据都在 `log-virtual` 的 `pinPlan`：
     * 用户自己滚到别处（例如滚到底看最新）时返回 `null`，本轮不动他的位置。 */
    const targetIndex = pinPlan({
      baseline: baselineRef.current,
      applied: appliedRef.current,
      bottomIndex: visibleLogs.length - 1,
      scrollTop: el.scrollTop,
      appliedTop: appliedTopRef.current,
    });
    if (targetIndex === null) return;
    /* 贴到目标行的下边缘（减去一个视口高）：位置一律取自**位置表**
     * `rows[targetIndex]`，那是 `translateY` 与滚动条共用的同一份口径。
     *
     * ⚠️ **不能用 `target.offsetTop` 量**。虚拟化之后行的 `offsetParent` 是那层
     * `translateY` 过的内层容器，`offsetTop` 给的是「它在**当前窗口**里的位置」
     * 而不是「它在整页内容里的位置」；拿它算 `scrollTop` 会把视口拉回窗口起点
     * ——用户滚到底就再也回不去底（这条 e2e 抓到的正是它）。
     *
     * 目标行在窗口外时它根本不在 DOM 里，这一支天然也走同一个算式：把目标行带进
     * 窗口，下一轮 effect 按同一张表对齐（两轮同解，不再有「真实节点」与「估算
     * 位置」两套坐标）。`rows[targetIndex]` 与 `pageLogs` 同源同长；真取不到就
     * 什么都不做，绝不能乱滚。 */
    const row = rows[targetIndex];
    if (!row) return;
    const next = pinScrollTop(
      { start: row.start, size: row.size },
      el.clientHeight,
    );
    el.scrollTop = next;
    appliedTopRef.current = next;
    appliedRef.current = targetIndex;
  }, [
    isOpen,
    autoScroll,
    safePage,
    revision,
    followResetAt,
    visibleLogs.length,
    rows,
  ]);

  /* 视口尺寸（滚动视口高度 + 可供正文使用的宽度）。
   *
   * 高度决定**渲染几行**；宽度决定**软换行估几行**（见 log-virtual 的
   * `countLines`）。两者都必须重新量：面板可以加宽（标题栏的「加宽」按钮）、
   * 窗口可以缩放、正文列还会随滚动条出现而变窄。
   *
   * 用 ResizeObserver 而不是 window 的 resize：加宽按钮改的是元素宽度，
   * 窗口尺寸一点没变。观测不到（jsdom / 老浏览器）时不额外退化——量出来恒为
   * 0 已经会让下面的窗口逻辑走「整页渲染」那一支，行为与改动前一致。 */

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    /* 滚动位置是**渲染输入**（决定窗口取哪一段），因此进 state 而不是只留 ref：
     * 只读 ref 会出现「滚了但不重渲染、内容不更新」。 */
    setScrollTop(el.scrollTop);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    /* 贴着底 = 用户要看最新，基线就取末条（面板打开时 `autoScroll` 已是 true，
     * 若再要求 `!autoScroll` 则「从顶部滚到底」永远进不来，基线停在 0，下一轮
     * 轮询会把用户按回顶部）。
     *
     * 这里**只重取基线**（水位锚点），不动 `appliedRef`：那个 ref 回答的是「贴底
     * 上一次落在哪一行」，只有贴底 effect 自己写过才算数（`pinPlan` 据它判「用户
     * 有没有接管滚动」）。把滚动事件也算成「已落位」，会让 `pinPlan` 把「贴底刚被
     * 重取基线」误读成「用户自己滚走了」，于是本轮一步都不动 —— 用户滚到底后贴底
     * 不再跟到页尾，又回到「滚不到底」。 */
    if (nearBottom) {
      baselineRef.current = Math.max(0, visibleLogs.length - 1);
    }
    setFollowBottom(nearBottom);
  };

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
          {/* Header */}
          {/* 行头：宽窗口一行，窄窗口下筛选器整组折到第二行（判据是筛选器容器的
            `min-w-56`），所以行高用 `min-h`、允许内容把它撑高而不是钉死高度。 */}
          <div className="border-border-strong bg-surface-1 flex min-h-14 shrink-0 flex-wrap items-center gap-y-1.5 border-b px-4 py-2">
            <div className="flex shrink-0 items-center gap-2">
              <FileText size={16} className="text-primary-strong shrink-0" />
              {/* 标题不可换行：换行会把行头撑高、把下面的筛选器挤成竖排单字
                （窄窗口下实测就是这样）。宽度不够时宁可让别的元素让它。 */}
              <span className="text-ink-bright text-[15px] font-semibold whitespace-nowrap">
                应用日志
              </span>
              {/* 标题旁不复述任何计数：数字的唯一出口是右侧级别按钮（同一份
                `originCounts`），完整分类数（含信息）在各按钮的悬浮说明里。 */}
            </div>

            {/* Level filters：数字是**当前来源**下的计数，与右边来源下拉同口径。
              标签与数字**同行**（标签在左、计数在右）——这是本轮之前被否掉的一种
              排法，当时的问题是它**各占一份固有宽度**、不和别人分享空间：行头一挤
              就先把筛选器压到 32px、汉字只剩竖排的余地。
              现在筛选器整组 `flex-1`：它自己就是那块弹性空间，宽度随行头伸缩，
              每个按钮等分并在有富余时一起变宽（用户诉求：「全部/警告/错误这些挤
              在一起，可以占用大些空间」；「顶部还有较大空白区域」指的就是它们与
              搜索框之间那块被 `flex-1` 空白吸走的地方）。 */}
            {/* 这个容器同时承担两件事：
              1. **它自己就是那块弹性空间**——不再另设无名空白，五个按钮等分富余
                 宽度（用户诉求：「全部/警告/错误这些挤在一起，可以占用大些空间」）；
                 右侧的搜索 / 来源下拉 / 操作按钮也因此被顶到最右，不必再靠一个
                 单独的 `flex-1` 空白——多一个 `flex-1` 只会和它平分富余宽度，
                 于是「空白又回来了」。
              2. **`min-w-56` 是折行与否的判据**：可用宽度不足 224px 时它整组落到
                 第二行（`flex-wrap` 的换行单位就是这个容器）并吃掉整行宽度。
                 比「每个按钮各自 min-w 后硬挤」好在：无论多窄，标签都保持可读，
                 不会退化成只剩一列竖字。 */}
            <LogFilterBar originCounts={originCounts} />

            {/* 来源筛选贴最右（用户要求：中间让出来的宽度归左侧的类别与条数）。
              候选列表每项自带「条数 / 信息 / 警告 / 错误」四列——此前只有名字，
              用户必须先切过去才知道那边有没有问题（ISSUE #360）。 */}
            <OriginSelect
              value={origin ?? "all"}
              countsByOrigin={countsByOrigin}
              onChange={setOrigin}
            />

            {/* Actions */}
            <div className="flex items-center gap-1 pl-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setWrap((prev) => !prev)}
                title={wrap ? "折叠超长行" : "自动换行显示"}
                /* 选中态与级别按钮同一份：`bg-subtle` 在浅色主题下与行头底色同值。 */
                className={`rounded-md p-2 transition-colors ${
                  wrap
                    ? `${FILTER_SELECTED_STYLES} text-ink-bright`
                    : "text-ink-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                <Type size={16} />
              </Button>
              {/* title 写明范围：复制/下载的是**当前筛选下的全部日志**（跨所有页）。
               * 复制这枚自己带成败反馈（§16.2.4.43）—— 失败时原地换成「复制失败」
               * 并说明怎么自救，成功时短暂换成对勾。 */}
              <Button
                variant="ghost"
                size="icon"
                onClick={copyAllAction}
                title={
                  copyFailed
                    ? copyFailureText("日志列表")
                    : `复制当前筛选的全部日志（${scopeLabel} · ${total} 条）`
                }
                aria-label="复制当前筛选的全部日志"
                className={`rounded-md ${
                  copyFailed
                    ? "text-danger-strong"
                    : "text-ink-muted hover:bg-subtle hover:text-ink"
                }`}
              >
                {copyFailed ? (
                  <span className="text-[10px] whitespace-nowrap">
                    复制失败
                  </span>
                ) : copyOutcome.on ? (
                  <Check size={16} />
                ) : (
                  <Copy size={16} />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={download}
                title={`下载为文本文件（当前筛选的全部日志：${scopeLabel} · ${total} 条）`}
                aria-label="下载当前筛选的全部日志"
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              >
                <Download size={16} />
              </Button>
              {/* 服务端落盘版导出（见 SaveExportButton）。 */}
              <SaveExportButton
                label={origin ?? "all"}
                scopeLabel={scopeLabel}
                total={total}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={clear}
                title="清空面板"
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              >
                <Trash2 size={16} />
              </Button>
              <WidePanelToggle
                panel={panel}
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                title="关闭 (Ctrl+Shift+L)"
                className="text-ink-muted hover:bg-subtle hover:text-ink rounded-md"
              >
                <X size={16} />
              </Button>
            </div>
          </div>

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
          <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
            <span className="flex items-center gap-2">
              <span>
                {pageSummary(
                  safePage,
                  totalPages,
                  pageSize,
                  total,
                  counts.all,
                  search,
                )}
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
                  className="border-border-strong text-ink-muted shrink-0 rounded border px-1.5 py-px text-[11px]"
                  title={`应用服务进程标识：${bootId}（重启后会变化，面板据此重置时间线）`}
                >
                  服务 {bootId.split(":").slice(-2).join(":")}
                </span>
              )}
            </span>
            <span className="flex items-center gap-3">
              {shouldPin && (
                <Button
                  variant="primary-solid"
                  size="xs"
                  onClick={jumpToLatest}
                >
                  <ArrowDownToLine size={12} />
                  {newLogCount > 0
                    ? `有 ${newLogCount} 条新的日志 · 回到最新`
                    : "回到最新"}
                </Button>
              )}
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage <= 1}
                  title="更新的一页"
                  className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
                >
                  <ChevronLeft size={14} />
                </Button>
                {/* 当前正看的是哪一段（来源 / 级别 / 搜索词），点任意一项即去掉
                  那一层筛选。此处用按钮而不是纯文本：页脚是「说出来我在看什么」
                  的位置，回滚动作本来就该在这儿，不必让用户跑回顶部找。 */}
                <span className="text-ink-soft flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setOrigin("all")}
                    disabled={!origin || origin === "all"}
                    title={
                      origin && origin !== "all" ? "去掉来源筛选" : undefined
                    }
                    className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md tabular-nums disabled:cursor-default"
                  >
                    {ORIGIN_TEXT[origin ?? "all"]}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setFilter("all")}
                    disabled={filter === "all"}
                    title={filter !== "all" ? "去掉级别筛选" : undefined}
                    className="enabled:hover:bg-subtle enabled:hover:text-ink rounded-md disabled:cursor-default"
                  >
                    {FILTER_LABELS.find((item) => item.value === filter)?.label}
                  </Button>
                  {search.trim() && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSearch("")}
                      title="清空搜索"
                      className="hover:bg-subtle hover:text-ink max-w-40 truncate rounded-md"
                    >
                      {`搜索「${search.trim()}」`}
                    </Button>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= totalPages}
                  title="更早的一页"
                  className="text-ink-soft hover:bg-subtle hover:text-ink rounded-md"
                >
                  <ChevronRight size={14} />
                </Button>
              </span>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 取当前选区（浏览器里是 `window.getSelection()`）。
 *
 * 抽成函数是为了让上面的贴底 effect 能「取不到就说没有」：jsdom 没有
 * `getSelection`，返回 null 后 `selectionInsideLogs` 会给出 false，
 * 贴底行为与既有测试一致，不会因为多了一道判据而整体失效。
 */
function currentSelection() {
  if (typeof window === "undefined") return null;
  if (typeof window.getSelection !== "function") return null;
  return window.getSelection();
}
