/* ── 画布历史面板：controller hook（第②层逻辑）─────────────────────────
 * 承载 HistoryPanel 的全部数据逻辑：
 *   - 列表查询（按作用域 project/all + 类型筛选）
 *   - 「本项目为空时探一次全局」的引导探测
 *   - 进行中任务的 4s 轮询（跑完自动停）
 *   - 错误通道：只此一份，且**不会被随后的轮询清空**
 *     （§17.5.4 的同源坑：错误必须由「发起动作的一方」清，这里指用户点「重试」）
 *
 * 视图态（网格/列表密度）也在这里——它决定不了任何业务，但和刷新票据
 * 一样属于「面板状态」；放在 hook 里让视图只剩 JSX + props。
 */

"use client";

import { useEffect, useState } from "react";
import { useRefreshTicket } from "~/components/ui/use-refresh-ticket";

import { useInterval } from "~/components/ui/use-interval";
import { errorMessage } from "~/lib/error-message";
import { beginStaleRun } from "~/lib/stale-run";
import {
  fetchHistoryTasks,
  probeGlobalTaskCount,
} from "~/lib/project-canvas/history-panel-client";
import {
  countActive,
  type DisplayMode,
  type HistoryFilter,
  type HistoryScope,
  type HistoryTaskRow,
  type TaskMediaType,
} from "~/lib/project-canvas/history-panel-types";

/** 主列表一次取多少条。画布侧栏不做分页，80 条足够滚动浏览。 */
const TAKE = 80;
/** 有任务在跑时的轮询间隔。 */
const POLL_MS = 4000;

export interface UseHistoryPanelArgs {
  /** 当前画布项目 id；有值时默认只看本项目记录。 */
  projectId?: string | null;
}

export interface HistoryPanelController {
  tasks: HistoryTaskRow[];
  loading: boolean;
  error: string | null;
  scope: HistoryScope;
  filter: HistoryFilter;
  display: DisplayMode;
  /** 进行中任务数（>0 时轮询开启）。 */
  activeCount: number;
  /** 全局记录数；null = 未探测/探测失败，不显示「查看全部」引导。 */
  globalCount: number | null;
  setScope: (scope: HistoryScope) => void;
  setFilter: (filter: HistoryFilter) => void;
  setDisplay: (display: DisplayMode) => void;
  refresh: () => void;
}

export function useHistoryPanel({
  projectId,
}: UseHistoryPanelArgs): HistoryPanelController {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [scope, setScope] = useState<HistoryScope>(
    projectId ? "project" : "all",
  );
  const [display, setDisplay] = useState<DisplayMode>("list");

  const [tasks, setTasks] = useState<HistoryTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* 「按需求重跑一遍取数」走唯一出口（规范 16 §16.2.4.70）。 */
  const { ticket: reloadKey, refresh } = useRefreshTicket();

  /** 全局是否有记录 —— 本项目为空时用来决定是否提示「查看全部」。 */
  const [globalCount, setGlobalCount] = useState<number | null>(null);

  /* ── 拉取任务 ── */
  useEffect(() => {
    /* 这一轮的作废守卫（规范 16 §16.2.4.34）：卸载、或切筛选 / 作用域、
     * 或点「重试」都会重开一轮，旧轮次的结果（**含失败文案与空列表**）
     * 一律不落地。 */
    const guard = beginStaleRun();
    const run = async () => {
      setLoading(true);
      setError(null);
      const params: {
        take: number;
        projectId?: string;
        media?: TaskMediaType;
      } = { take: TAKE };
      if (scope === "project" && projectId) params.projectId = projectId;
      /* "all" 不是服务端认识的 media 枚举，只在筛选非全部时才带上。 */
      if (filter !== "all") params.media = filter;
      try {
        const rows = await fetchHistoryTasks(params);
        guard.commit(() => setTasks(rows));
      } catch (e) {
        /* 错误文案与清空列表都属于「这一轮的结论」，一起过守卫。 */
        guard.commit(() => {
          setError(errorMessage(e, "读取历史记录失败"));
          setTasks([]);
        });
      } finally {
        guard.commit(() => setLoading(false));
      }
    };
    void run();
    return () => guard.dispose();
  }, [projectId, scope, filter, reloadKey]);

  /* ── 本项目为空时探一次全局，以便给出「查看全部」引导 ── */
  useEffect(() => {
    if (
      scope !== "project" ||
      loading ||
      tasks.length > 0 ||
      globalCount !== null
    )
      return;
    const guard = beginStaleRun();
    void probeGlobalTaskCount().then((count) => {
      guard.commit(() => setGlobalCount(count));
    });
    return () => guard.dispose();
  }, [scope, loading, tasks.length, globalCount]);

  const activeCount = countActive(tasks);

  /* ── 有任务在跑时轮询（4s），跑完自动停 ── */
  /* 有任务在跑时轮询（4s），跑完自动停。`useInterval` 内部把回调放 ref，
   * 所以这里不必再自己维护 `refreshRef`（规范 16 §16.2.4.15）。 */
  useInterval(refresh, { ms: activeCount > 0 ? POLL_MS : null });

  return {
    tasks,
    loading,
    error,
    scope,
    filter,
    display,
    activeCount,
    globalCount,
    setScope,
    setFilter,
    setDisplay,
    refresh,
  };
}
