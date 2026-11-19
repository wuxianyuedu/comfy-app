"use client";

// 画布镜头节点 → Shot 生成态回写的触发侧（Phase 3c-2b）。
// 仅在节点带 shotId 且进入终态（done / error）时回写一次；ref 按
// (shotId|status|url|taskId) 去重，避免挂载对账与本轮生成重复落库。
// IO 在 ~/lib/production/shot-writeback，本 hook 只做编排（视图/hook 不直接 fetch）。
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
    if (shotId === undefined || shotId === "") {
      return;
    }
    // 只回写终态：running / idle 属于中间态，落库无意义且会与工坊写入面抢字段。
    if (status !== "done" && status !== "error") {
      return;
    }
    const projectId = getActiveId();
    if (projectId === null || projectId === "") {
      return;
    }
    const key = `${shotId}|${status}|${resultPath ?? ""}|${taskId ?? ""}`;
    if (key === lastKeyRef.current) {
      return;
    }
    lastKeyRef.current = key;
    void recordCanvasShotGeneration(
      projectId,
      shotId,
      nodeGenToShot({ status, taskId, resultPath }),
    );
  }, [shotId, status, resultPath, taskId]);
}
