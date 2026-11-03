"use client";

/**
 * useProjectPersistence — 项目画布「持久化三件套」hook。
 * 1) 500ms debounce 落盘；2) 600ms mutation effect 跳过 hydrate 后首轮空写；3) 卸载即 flush。
 * 外加镜像被拒出口（useSyncRefusalNotice）：localStorage 是事实源、服务端是镜像，拒收不能 `catch {}` 吞掉（硬规则 4）；persistNow() 供切换/新建/重命名/删除复用。
 */

import { useCallback, useEffect, useRef } from "react";
import type { Edge } from "@xyflow/react";

import type { CanvasNodeType } from "~/lib/project-canvas/canvas-types";
import {
  clearActiveIfDraft,
  isEmptyDraftName,
  reapEmptyProject,
  upsertProject,
} from "~/lib/project-canvas/canvas-store";
import { useSyncRefusalNotice } from "./use-sync-refusal-notice";

export type UseProjectPersistenceParams = {
  edges: Array<Edge>;
  /** 项目是否已完成首次加载（!hydrating）；false 时不触发持久化。 */
  loaded: boolean;
  nodes: Array<CanvasNodeType>;
  projectId: string | null;
  projectName: string;
};

export function useProjectPersistence({
  projectId,
  nodes,
  edges,
  projectName,
  loaded,
}: UseProjectPersistenceParams) {
  /* 镜像被拒的出口与本 hook 同生命周期：本文件已经在跑持久化了，
   * 再开一个组件级订阅点等于把「谁在管这件事」拆成两处。 */
  useSyncRefusalNotice();

  /** 始终指向最新快照，供 persistNow 读取，避免闭包过期。 */
  const ref = useRef({ projectId, nodes, edges, projectName });
  useEffect(() => {
    ref.current = { projectId, nodes, edges, projectName };
  });

  /** hydrate 后首轮 setNodes/setEdges 会造成「空项目覆盖」误写，跳过一次。 */
  const firstMutationRef = useRef(true);

  /** 立即按当前快照落盘（draft-aware：空草稿不建库、自动回收）。
   *  nameOverride：重命名提交时 ref 尚未同步到新名字，需显式传入。 */
  const persistNow = useCallback((nameOverride?: string) => {
    const {
      projectId: pid,
      nodes: liveNodes,
      edges: liveEdges,
      projectName: liveName,
    } = ref.current;
    if (pid === null || pid === "") {
      return;
    }

    const nameLive = nameOverride ?? liveName;
    const isEmpty = liveNodes.length === 0 && liveEdges.length === 0;
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
      nodes: liveNodes,
      edges: liveEdges,
    });
  }, []);

  /* 500ms debounce：内容变化（含重命名）后落盘。 */
  useEffect(() => {
    if (projectId === null || projectId === "" || !loaded) {
      return;
    }
    const t = setTimeout(() => {
      persistNow();
    }, 500);
    return () => {
      clearTimeout(t);
    };
  }, [nodes, edges, projectId, projectName, loaded, persistNow]);

  /* 600ms mutation effect：跳过加载后首轮变更，后续变更落盘。 */
  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (ref.current.projectId === null || ref.current.projectId === "") {
      return;
    }
    if (firstMutationRef.current) {
      firstMutationRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      persistNow();
    }, 600);
    return () => {
      clearTimeout(t);
    };
  }, [nodes, edges, loaded, persistNow]);

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
