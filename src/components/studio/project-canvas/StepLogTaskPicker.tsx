"use client";

/**
 * StepLogTaskPicker —— 步骤日志弹窗里「切换查看的任务」下拉框。
 * 单独成组件是为把 `useNodes()` 订阅关在最小范围：画布拖拽/平移每帧都换节点数组引用，
 * 订阅挂在面板顶层会让未打开的面板也被带着重渲染；序号只在这里用，面板未打开时下拉不挂载。
 */

import { memo, useMemo } from "react";
import { useNodes } from "@xyflow/react";
import { nodeSeqOf } from "./node-seq";
import { loadStepLogPanelState } from "./stepLogCache";
import { getNodeIdByTaskId } from "./activeTask";
import { SelectMenu } from "~/components/ui/select-menu";
import { Hint } from "~/components/ui/hint";

export const StepLogTaskPicker = memo(function StepLogTaskPicker({
  cachedIds,
  taskId,
  onSelect,
}: {
  cachedIds: Array<string>;
  onSelect: (next: string | null) => void;
  taskId: string | null;
}) {
  /* 序号 = 任务所在画布节点的下标 + 1。查表走 `nodeSeqOf`：画布每帧换一份
   * nodes 引用，逐个 `findIndex` 会退化成 O(缓存任务数 × 节点数) 每帧。 */
  const nodes = useNodes();
  const seqByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    for (const cachedId of cachedIds) {
      const nodeId = getNodeIdByTaskId(cachedId) ?? loadStepLogPanelState(cachedId)?.nodeId;
      if (nodeId === undefined || nodeId === "") {
        continue;
      }
      const seq = nodeSeqOf(nodes, nodeId);
      if (seq !== null) {
        map.set(cachedId, seq);
      }
    }
    return map;
  }, [cachedIds, nodes]);

  return (
    <SelectMenu
      aria-label="切换查看的任务"
      className="text-2xs max-w-50"
      labels={Object.fromEntries(
        cachedIds.map((id) => {
          const meta = loadStepLogPanelState(id);
          const seq = seqByTaskId.get(id);
          const wn = meta?.workflowName?.trim();
          const st = meta?.status ?? "?";
          const seqLabel = seq === null ? null : `#${seq}`;
          const titleParts = [seqLabel, wn, st, id].filter(Boolean);
          const displayParts = [seqLabel, wn ?? `task ${id.slice(0, 8)}`, st].filter(Boolean);
          return [
            id,
            <Hint key={id} label={titleParts.join(" ·")}>
              <span>{displayParts.join(" ·")}</span>
            </Hint>,
          ];
        }),
      )}
      onChange={(v) => {
        onSelect(v || null);
      }}
      options={cachedIds}
      placeholder={taskId !== null && taskId !== "" ? undefined : "（无任务）"}
      value={taskId ?? ""}
    />
  );
});
