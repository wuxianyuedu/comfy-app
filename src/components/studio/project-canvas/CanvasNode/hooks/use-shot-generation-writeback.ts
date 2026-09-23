"use client";

// 画布镜头节点 → Shot 生成态回写的触发侧（Phase 3c-2b）。
//
// 在节点带 data.shotId、且生成态进入终态（done / error）时，回写一次到对应 Shot。
// 用 ref 按 (shotId|status|url|taskId) 去重，避免运行中 / 进度抖动反复推，也避免
// 挂载对账与本轮生成对同一终态重复落库。IO 全在 ~/lib/production/shot-writeback，
// 本 hook 只做「观察节点状态 → 调一次落库」的编排（视图/hook 不直接 fetch）。
import { useEffect, useRef } from "react";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { nodeGenToShot } from "~/lib/production/sync";
import { recordCanvasShotGeneration } from "~/lib/production/shot-writeback";
import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";

export function useShotGenerationWriteback(d: CanvasNodeData): void {
  const lastKeyRef = useRef("");
  const shotId = d.shotId;
  const status = d.status;
  const resultPath = d.resultPath;
  const taskId = d.taskId;

  useEffect(() => {
    if (!shotId) return;
    // 只回写终态：running / idle 属于中间态，落库无意义且会与工坊写入面抢字段。
    if (status !== "done" && status !== "error") return;
    const projectId = getActiveId();
    if (!projectId) return;
    const key = `${shotId}|${status}|${resultPath ?? ""}|${taskId ?? ""}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    void recordCanvasShotGeneration(
      projectId,
      shotId,
      nodeGenToShot({ status, taskId, resultPath }),
    );
  }, [shotId, status, resultPath, taskId]);
}
