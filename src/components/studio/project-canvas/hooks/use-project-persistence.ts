"use client";

/**
 * useProjectPersistence — 项目画布「持久化三件套」hook。
 * 1) 500ms debounce 落盘；2) 卸载即 flush。
 * 外加镜像被拒出口（useSyncRefusalNotice）：localStorage 是事实源、服务端是镜像，拒收不能 `catch {}` 吞掉（硬规则 4）；persistNow() 供切换/新建/重命名/删除复用。
 *
 * 非受控画布（#4541，同 #4536）：节点 / 连线住在 React Flow 自己的 store 里，
 * 本 hook **订阅 store** 感知变化（拖拽的逐帧更新也在这里，debounce 只保留
 * 最后一次），不再经 React state 的 effect 链。
 */

import { useCallback, useEffect, useRef } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";

import { isCanvasNodeType } from "~/lib/project-canvas/canvas-types";
import {
  clearActiveIfDraft,
  isEmptyDraftName,
  reapEmptyProject,
  upsertProject,
} from "~/lib/project-canvas/canvas-store";
import { useSyncRefusalNotice } from "./use-sync-refusal-notice";

export type UseProjectPersistenceParams = {
  /** 项目是否已完成首次加载（!hydrating）；false 时不订阅、不触发持久化。 */
  loaded: boolean;
  projectId: string | null;
  projectName: string;
};

const PERSIST_DEBOUNCE_MS = 500;

export function useProjectPersistence({
  projectId,
  projectName,
  loaded,
}: UseProjectPersistenceParams) {
  /* 镜像被拒的出口与本 hook 同生命周期：本文件已经在跑持久化了，
   * 再开一个组件级订阅点等于把「谁在管这件事」拆成两处。 */
  useSyncRefusalNotice();
  const store = useStoreApi();
  const rf = useReactFlow();

  /** 始终指向最新快照，供 persistNow 读取，避免闭包过期。 */
  const ref = useRef({ projectId, projectName });
  useEffect(() => {
    ref.current = { projectId, projectName };
  });

  /** 立即按当前画布快照落盘（draft-aware：空草稿不建库、自动回收）。
   *  nameOverride：重命名提交时 ref 尚未同步到新名字，需显式传入。 */
  const persistNow = useCallback(
    (nameOverride?: string) => {
      const { projectId: pid, projectName: liveName } = ref.current;
      if (pid === null || pid === "") {
        return;
      }
      /* 类型守卫收回画布节点类型（禁新增字面断言）：本画布只创建 canvasNode /
       * workflowArdot 两种节点，守卫在实践中是恒等过滤。 */
      const nodes = rf.getNodes().filter(isCanvasNodeType);
      const edges = rf.getEdges();
      const nameLive = nameOverride ?? liveName;
      const isEmpty = nodes.length === 0 && edges.length === 0;
      if (isEmpty && isEmptyDraftName(nameLive)) {
        /* 顺序是「先问能不能回收，再决定要不要清 active」：反过来会让
         * `reapEmptyProject` 拒绝回收时（ISSUE #1501 起）active 已被清，
         * 留下「项目还在、上下文没了」的半截状态。回收语义要求两件事一起做或都不做。 */
        if (reapEmptyProject(pid)) {
          clearActiveIfDraft(pid);
        }
        return;
      }
      upsertProject({
        id: pid,
        name: nameLive,
        updatedAt: Date.now(),
        nodes,
        edges,
      });
    },
    [rf],
  );

  /* 订阅画布变化（非受控画布的唯一变化通道）：store 每次变化（拖拽逐帧、
   * 增删节点 / 连线）都重排 500ms debounce —— 连续变化只保留最后一次，
   * 与受控时代「nodes/edges 变化 → effect 重跑 → 500ms 防抖」同一语义。
   * 订阅本身在 loaded（水合完成）之后才建立：水合灌进来的那批节点不需要
   * 立刻写回去（数据就是从这里读的），第一次真正的用户编辑才触发落盘。 */
  useEffect(() => {
    if (projectId === null || projectId === "" || !loaded) {
      return;
    }
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        persistNow();
      }, PERSIST_DEBOUNCE_MS);
    };
    const unsubscribe = store.subscribe(schedule);
    return () => {
      unsubscribe();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [projectId, loaded, store, persistNow]);

  /* 重命名也要落盘（画布内容没变、名字变了）。 */
  useEffect(() => {
    if (projectId === null || projectId === "" || !loaded) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistNow();
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [projectName, projectId, loaded, persistNow]);

  /* 切走 / 关页前立即 flush，避免丢最近一次编辑。 */
  useEffect(() => {
    const flush = () => {
      persistNow();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [persistNow]);

  return { persistNow };
}
