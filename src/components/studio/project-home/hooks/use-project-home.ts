"use client";

// ── 项目主页：业务逻辑层（规范 17 §17.2 第②层）───────────────────────────
//
// 主页要回答两个问题，来源是同一份 production 行 + 同一份 run：
//   ① 「这个项目做到哪了」—— 取 production，经 `lib/production/project-home`
//      派生阶段总览（判据在纯函数里，这里只做取数与接线）；
//   ② 「AI 自主成片跑到哪了」—— 复用 `agent-run` 那份 `useAgentRun`
//      （不另起一套轮询：同一个 run 拉两路会让控制条与主页显示不同步）。
//
// 读的是**服务端**的 production 行，不是本地画布 store：工坊的产出（剧本 /
// 角色 / 镜头）只落 production 表，本地 store 里没有 —— 拿它算状态会永远显示
// 「还没开始」。取数失败静默回落空态（主页是只读展示，不该弹错），
// 由用户刷新或切回来重取。

import { useCallback, useEffect, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import {
  useAgentRun,
  type AgentRunController,
} from "~/components/agent-run/use-agent-run";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { fetchProduction } from "~/lib/production/production-client";
import {
  deriveProjectOverview,
  overviewHeadline,
  type ProjectOverview,
} from "~/lib/production/project-home";
import {
  DEFAULT_PRODUCTION_PROGRESS,
  normalizeProductionProgress,
} from "~/lib/production/progress";
import { toRunView, type ProductionRun } from "~/lib/production/run-types";
import { beginStaleRun } from "~/lib/stale-run";

/** run 在跑时刷新项目状态的周期（run 推进阶段后会改 production，主页要跟上）。 */
const ACTIVE_REFRESH_MS = 5000;

export interface ProjectHomeController {
  /** 活跃项目 id（无项目为空串）。 */
  projectId: string;
  /** 项目状态总览（未取到前是空项目的形状，不是 null —— 视图不必判两遍）。 */
  overview: ProjectOverview;
  /** 顶栏那一句（「下一步：镜头生图」这类）。 */
  headline: string;
  /** 首次取数完成前为真（视图据此显示加载态而不是「还没开始」）。 */
  loading: boolean;
  /** 主动重取一次（评审 / 退回某镜后刷新用，也挂在 run 跑动时）。 */
  refresh: () => Promise<void>;
  /** AI 自主成片的控制器（与工坊 / 画布同一份 run）。 */
  run: AgentRunController;
}

export function useProjectHome(): ProjectHomeController {
  const [projectId] = useState(() => getActiveId() ?? "");
  const run = useAgentRun();

  const [runView, setRunView] = useState(() => toRunView(null));
  const [progress, setProgress] = useState(DEFAULT_PRODUCTION_PROGRESS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    const production = await fetchProduction(projectId);
    setRunView(toRunView(production));
    setProgress(normalizeProductionProgress(production?.progress));
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const guard = beginStaleRun();
    void (async () => {
      const production = await fetchProduction(projectId);
      guard.commit(() => {
        setRunView(toRunView(production));
        setProgress(normalizeProductionProgress(production?.progress));
        setLoading(false);
      });
    })();
    return () => guard.dispose();
  }, [projectId]);

  /* run 跑动 / 待确认时顺带刷新项目状态：引擎每一步都会改 production，
   * 不刷的话主页的阶段条会停在「启动前」的样子。停着的时候不轮询（无人看时
   * 不打服务端，与状态栏那格的订阅口径一致）。 */
  const runActive =
    run.run.status === "running" || run.run.status === "awaiting_approval";
  useInterval(
    () => {
      void load();
    },
    { ms: runActive ? ACTIVE_REFRESH_MS : null, immediate: false },
  );

  const overview = deriveProjectOverview(runView, progress);

  return {
    projectId,
    overview,
    headline: overviewHeadline(overview),
    loading,
    refresh: load,
    run,
  };
}

/* 主页只读展示，`run.run` 的归一在 `useAgentRun` 里已经做过；这里重新导出
 * 一次类型，是为了让视图不必再 import 一层 run-types 只为标注 props。 */
export type { ProductionRun };
