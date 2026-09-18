/* ── 画布历史面板：controller hook（第②层逻辑）─────────────────────────
 * 承载 HistoryPanel 的全部数据逻辑：
 *   - 列表查询（按作用域 project/all + 类型筛选）
 *   - 「本项目为空时探一次全局」的引导探测
 *   - 进行中任务的 4s 轮询（跑完自动停）
 *   - 错误通道：只此一份，且**不会被随后的轮询清空**
 *     （§17.5.4 的同源坑：错误必须由「发起动作的一方」清，这里指用户点「重试」）
 *
 * 视图态（网格/列表密度）也在这里——它决定不了任何业务，但和 reloadKey
 * 一样属于「面板状态」；放在 hook 里让视图只剩 JSX + props。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "~/lib/error-message";
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
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  /** 全局是否有记录 —— 本项目为空时用来决定是否提示「查看全部」。 */
  const [globalCount, setGlobalCount] = useState<number | null>(null);

  /* ── 拉取任务 ── */
  useEffect(() => {
    let cancelled = false;
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
        if (cancelled) return;
        setTasks(rows);
      } catch (e) {
        if (cancelled) return;
        setError(errorMessage(e, "读取历史记录失败"));
        setTasks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
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
    let cancelled = false;
    void probeGlobalTaskCount().then((count) => {
      if (cancelled) return;
      setGlobalCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, loading, tasks.length, globalCount]);

  const activeCount = countActive(tasks);

  /* ── 有任务在跑时轮询（4s），跑完自动停 ── */
  const refreshRef = useRef(refresh);
  // 让轮询回调保持新鲜，又不在渲染中途读写 ref
  //（React Compiler 禁止渲染期间访问 ref；这个定时器只会在 effect 跑完后
  // 触发，所以时序等价）。
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (activeCount === 0) return;
    const timer = setInterval(() => refreshRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [activeCount]);

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
