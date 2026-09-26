"use client";

/**
 * StepLogTaskPicker —— 步骤日志弹窗里「切换查看的任务」下拉框。
 *
 * 单独成组件是为了把 `useNodes()` 的订阅关在最小范围里：画布拖拽 / 平移每帧都会
 * 换一份节点数组引用，订阅若挂在面板顶层，面板即使已经 `return null`（未打开）
 * 也会被每帧带着重渲染一遍；而序号只在这个下拉框里用得到，面板未打开时它根本
 * 不挂载，订阅随之消失。
 */

import { memo, useMemo } from "react";
import { useNodes } from "@xyflow/react";
import { nodeSeqOf } from "./node-seq";
import { loadStepLogPanelState } from "./stepLogCache";
import { getNodeIdByTaskId } from "./activeTask";
import { SelectMenu } from "~/components/ui/select-menu";

export const StepLogTaskPicker = memo(function StepLogTaskPicker({
  cachedIds,
  taskId,
  onSelect,
}: {
  cachedIds: string[];
  taskId: string | null;
  onSelect: (next: string | null) => void;
}) {
  /* 序号 = 任务所在画布节点的下标 + 1。查表走 `nodeSeqOf`：画布每帧换一份
   * nodes 引用，逐个 `findIndex` 会退化成 O(缓存任务数 × 节点数) 每帧。 */
  const nodes = useNodes();
  const seqByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    for (const cachedId of cachedIds) {
      const nodeId =
        getNodeIdByTaskId(cachedId) ?? loadStepLogPanelState(cachedId)?.nodeId;
      if (!nodeId) continue;
      const seq = nodeSeqOf(nodes, nodeId);
      if (seq !== null) map.set(cachedId, seq);
    }
    return map;
  }, [cachedIds, nodes]);

  return (
    <SelectMenu
      value={taskId ?? ""}
      onChange={(v) => onSelect(v || null)}
      options={cachedIds}
      labels={Object.fromEntries(
        cachedIds.map((id) => {
          const meta = loadStepLogPanelState(id);
          const seq = seqByTaskId.get(id);
          const wn = meta?.workflowName?.trim();
          const st = meta?.status ?? "?";
          const seqLabel = seq ? `#${seq}` : null;
          const titleParts = [seqLabel, wn, st, id].filter(Boolean);
          const displayParts = [
            seqLabel,
            wn ?? `task ${id.slice(0, 8)}`,
            st,
          ].filter(Boolean);
          return [
            id,
            <span key={id} title={titleParts.join(" ·")}>
              {displayParts.join(" ·")}
            </span>,
          ];
        }),
      )}
      placeholder={taskId ? undefined : "（无任务）"}
      aria-label="切换查看的任务"
      className="max-w-[200px] text-[10.5px]"
    />
  );
});
