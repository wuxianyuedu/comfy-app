"use client";

/**
 * 「界面打开」日志的唯一落点 —— 补记**打开耗时**：从「这一屏成为当前页」（工作区页面激活时刻）到「内容组件真的挂载」的毫秒数。
 * 测量点必须放进内容本体：懒加载视图由 `next/dynamic`（`ssr:false` 走 Loadable）渲染，分块未到位时先渲染占位，任何外层包裹在激活那一刻就挂载、量到的是 0；`withViewOpenReport` 在分块解析后包住内容，才对应「界面真的出来了」。
 * 「打开时刻」由 `WorkspaceViewStack` 经 context 交来（激活后的一次 `performance.now()`，与对应视图成对存放、切换时更新：同一视图的两个项目页签算同一屏）；懒加载视图经 `withViewOpenReport` 包，即时加载的直接由视图栈包。
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";

import { postAppRuntimeLog } from "~/lib/log/log-file-client";

import { pageHeaderTitle, type WorkspaceView } from "./NavItems";

/** 当前屏「打开时刻」的查询口：不是当前屏（还没激活）、或还没落定时返回 null。 */
export type ViewOpenedAtLookup = (view: WorkspaceView) => number | null;

export const ViewOpenedAtContext = createContext<ViewOpenedAtLookup | null>(null);

/**
 * 把一屏内容包一层：内容挂载时补记一条「界面打开：<屏名> 耗时 <n>ms」。收 `children` 而不是「收组件」，是为了两种用法共用同一份判据（即时加载由视图栈直接包，懒加载经 `withViewOpenReport` 包在解析后的组件外）。
 */
export function ViewOpenReport({ view, children }: { children: ReactNode; view: WorkspaceView }) {
  const openedAt = useContext(ViewOpenedAtContext)?.(view) ?? null;
  /* 同一个打开时刻只记一次：既挡 StrictMode 双跑 effect，也挡「时刻没变的重渲染」。
     换了一个新的打开时刻（= 这一屏又被打开一次，比如关掉页签再开）就重新记。 */
  const reportedRef = useRef<number | null>(null);
  useEffect(() => {
    if (openedAt === null || reportedRef.current === openedAt) {
      return;
    }
    reportedRef.current = openedAt;
    const durationMs = Math.round(performance.now() - openedAt);
    void postAppRuntimeLog(
      "app",
      "info",
      `界面打开：${pageHeaderTitle(view)} 耗时 ${durationMs}ms`,
      { view, durationMs },
    );
  }, [openedAt, view]);
  return <>{children}</>;
}

/** 懒加载视图的包法：分块解析后才包一层，测量点正好落在内容挂载那一刻。 */
export function withViewOpenReport<P extends object>(
  view: WorkspaceView,
  Comp: ComponentType<P>,
): ComponentType<P> {
  function ViewOpenReported(props: P) {
    return (
      <ViewOpenReport view={view}>
        <Comp {...props} />
      </ViewOpenReport>
    );
  }
  ViewOpenReported.displayName = `ViewOpenReported(${view})`;
  return ViewOpenReported;
}
