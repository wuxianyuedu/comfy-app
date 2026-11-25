"use client";
/* 非受控画布（#4536）的节点 / 连线写回包装。
 *
 * ⚠️ 这里必须把 updater **原样透传**给 `rf.setNodes / rf.setEdges`，禁止在调用点
 * 先用 `rf.getNodes()` 急切解析成字面量数组。原因在 @xyflow/react 12.12 的批量
 * 队列语义（BatchProvider）：`rf.setNodes(payload)` 只是把 payload push 进队列，
 * flush 时按序归并 `next = payload(next)` —— **同批后写者覆盖先写者**。
 *
 * 下钻子工作流那一拍有两个 effect 同批写节点表：画布同步 effect 先 push 新图
 * （字面量数组），paramMap 的 assignedRole 重同步 effect（use-workflow-persistence）
 * 再 push 一次。若包装器急切解析，第二个 push 拿到的是 flush 前的**旧 store 快照**
 * （还是父图），归并后旧图覆盖新图 —— 表现为「顶栏已切子图、画布停在父图」，
 * 用户再点下钻按钮就再压一层同名面包屑（ISSUE #5037）。透传后，第二个 push 是
 * 函数，flush 时对「当次归并中的最新图」求值，先落地的新图先被应用，竞态消失。
 */
import { useCallback } from "react";
import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";

export type RfTableWriters = {
  /** 写回连线表：收 updater，透传给 React Flow 的批量队列（见文件头说明）。 */
  rfSetEdges: (updater: (edges: Array<Edge>) => Array<Edge>) => void;
  /** 写回节点表：同上。 */
  rfSetNodes: (updater: (nodes: Array<Node>) => Array<Node>) => void;
};

export function useRfTableWriters(rf: ReactFlowInstance): RfTableWriters {
  const rfSetEdges = useCallback(
    (updater: (edges: Array<Edge>) => Array<Edge>) => {
      rf.setEdges(updater);
    },
    [rf],
  );
  const rfSetNodes = useCallback(
    (updater: (nodes: Array<Node>) => Array<Node>) => {
      rf.setNodes(updater);
    },
    [rf],
  );
  return { rfSetEdges, rfSetNodes };
}
