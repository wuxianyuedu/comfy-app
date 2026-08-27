"use client";

/**
 * useProjectPersistence — 项目画布「持久化三件套」hook。
 *
 * 从 CanvasInner 抽出三个相互关联的持久化 effect：
 *  1. 500ms debounce：nodes / edges / projectName 变化后落盘；
 *  2. 600ms mutation effect：跳过 hydrate 后首轮空写，再落盘；
 *  3. beforeunload + unmount 立即 flush（防止切走标签页丢数据）。
 *
 * 对外只暴露 persistNow()，供项目切换 / 新建 / 重命名 / 删除前
 * 「立即保存当前项目」复用，避免调用方各自再写一套 draft-aware 保存。
 */

import { useCallback, useEffect, useRef } from "react";
import type { Edge } from "@xyflow/react";
import type { CanvasNodeType } from "./canvas-types";
import {
  clearActiveIfDraft,
  isEmptyDraftName,
  reapEmptyProject,
  upsertProject,
} from "./canvas-store";

export interface UseProjectPersistenceParams {
  projectId: string | null;
  nodes: CanvasNodeType[];
  edges: Edge[];
  projectName: string;
  /** 项目是否已完成首次加载（!hydrating）；false 时不触发持久化。 */
  loaded: boolean;
}

export function useProjectPersistence({
  projectId,
  nodes,
  edges,
  projectName,
  loaded,
}: UseProjectPersistenceParams) {
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
    if (!pid) return;

    const nameLive = nameOverride ?? liveName;
    const isEmpty = liveNodes.length === 0 && liveEdges.length === 0;
    if (isEmpty && isEmptyDraftName(nameLive)) {
      clearActiveIfDraft(pid);
      reapEmptyProject(pid);
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
    if (!projectId || !loaded) return;
    const t = setTimeout(() => persistNow(), 500);
    return () => clearTimeout(t);
  }, [nodes, edges, projectId, projectName, loaded, persistNow]);

  /* 600ms mutation effect：跳过加载后首轮变更，后续变更落盘。 */
  useEffect(() => {
    if (!loaded) return;
    if (!ref.current.projectId) return;
    if (firstMutationRef.current) {
      firstMutationRef.current = false;
      return;
    }
    const t = setTimeout(() => persistNow(), 600);
    return () => clearTimeout(t);
  }, [nodes, edges, loaded, persistNow]);

  /* 切走 / 关页前立即 flush，避免丢最近一次编辑。 */
  useEffect(() => {
    const flush = () => persistNow();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [persistNow]);

  return { persistNow };
}
