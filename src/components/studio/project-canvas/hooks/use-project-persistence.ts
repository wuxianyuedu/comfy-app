"use client";

/**
 * useProjectPersistence — 项目画布「持久化三件套」hook。
 *
 * 从 CanvasInner 抽出三个相互关联的持久化 effect：
 *  1. 500ms debounce：nodes / edges / projectName 变化后落盘；
 *  2. 600ms mutation effect：跳过 hydrate 后首轮空写，再落盘；
 *  3. beforeunload + unmount 立即 flush（防止切走标签页丢数据）。
 *
 * 外加**镜像被拒的出口**（`useSyncRefusalNotice`）：localStorage 是画布的事实源，
 * 服务端那份是镜像，而「服务端明确不收这一份」过去被 `catch {}` 吞掉 ——
 * 界面显示已保存、换端口一看是空的。状态在 `~/lib/project-canvas/sync-notice`
 * 里可查，这里的职责就是把它变成用户看得见的一句话（硬规则 4）。
 *
 * 对外只暴露 persistNow()，供项目切换 / 新建 / 重命名 / 删除前
 * 「立即保存当前项目」复用，避免调用方各自再写一套 draft-aware 保存。
 */

import { useCallback, useEffect, useRef } from "react";
import type { Edge } from "@xyflow/react";

import { subscribeAppEvent } from "~/lib/app-events";
import type { CanvasNodeType } from "~/lib/project-canvas/canvas-types";
import {
  clearActiveIfDraft,
  isEmptyDraftName,
  reapEmptyProject,
  upsertProject,
} from "~/lib/project-canvas/canvas-store";
import { listSyncNotices } from "~/lib/project-canvas/sync-notice";
import { useToast } from "../../ToastProvider";

export interface UseProjectPersistenceParams {
  projectId: string | null;
  nodes: CanvasNodeType[];
  edges: Edge[];
  projectName: string;
  /** 项目是否已完成首次加载（!hydrating）；false 时不触发持久化。 */
  loaded: boolean;
}

/**
 * 拒收提示的停留时间（毫秒）。默认的 3.2s 是给「已经保存」这类回执用的；
 * 这一句是**要照着做的**（画布只在本地存住了，得改名字或换 id），
 * 所以按 `useToast` 里 `duration` 那个参数的口径给一档长的。
 */
const REFUSAL_TOAST_MS = 12_000;

/**
 * 「这份画布没能进服务端」的用户可见出口。
 *
 * 两条通道都要，缺一不可：
 *   · **挂载时先读一次状态** —— 写镜像的入口不止这一页：工作区首页的「新建项目」、
 *     `ProjectGate` 的重名新建、作品画廊的删除都会发镜像，而那些页面上没有提示器。
 *     那一次广播发出去没人接（本模块的事件不排队重放），只订阅不读表的写法
 *     会让它**永远看不见** —— 会在这里红，而不是等用户换端口发现画布是空的。
 *   · **订阅后续变化** —— 用户在画布上改动触发的自动保存，拒收发生在挂载之后。
 *
 * 提示按「同一条画布的同一句原因」去重：自动保存每 500ms 就会再撞一次，
 * 不去重会把界面刷成一串同样的 toast；而**原因变了**（改了名字之后变成另一条
 * 拒收理由）要重新说一次，所以去重的键带上文案而不是只带 id。
 */
function useSyncRefusalNotice(): void {
  const toast = useToast();
  /** 已经提示过的「画布 + 原因」，用于去重。 */
  const shown = useRef<string[]>([]);

  useEffect(() => {
    const flush = () => {
      for (const notice of listSyncNotices()) {
        /* 键用 JSON 而不是分隔符拼接：项目名与原因文案都可能含任意字符，
         * 拼出来的键会碰撞（`a|b` 与 `a|`+`b` 同形）——那是「两条不同拒收
         * 只提示一条」这种很难复现的表现。 */
        const key = JSON.stringify([notice.projectId, notice.detail]);
        if (shown.current.includes(key)) continue;
        shown.current = [...shown.current, key];
        toast.error(
          `画布「${notice.projectName}」没有同步到服务端`,
          notice.detail,
          REFUSAL_TOAST_MS,
        );
      }
    };
    flush();
    return subscribeAppEvent("comfyapp:canvas-sync-changed", flush);
  }, [toast]);
}

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
