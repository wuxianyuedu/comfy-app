"use client";
/* ── 参考图挂载编辑态（ISSUE #4534，规范 §17.2 第②层：逻辑收 hook）──
 * 顶栏按钮进入 / 退出；编辑态里点击画布节点即标记 / 取消多参考图挂载点，
 * 标记写进 paramMap.referenceLoaders.mountNodeIds 并**即时落库**（与 IO 模式
 * 提交同一口径，不依赖用户记得点「保存」）。装载计划按 image_0..N 规律把
 * 这些节点的图片口接成参考图落点（见 reference-loader-plan.ts）。
 * 被标记节点在画布上加主色描边高亮（样式见 globals.css 的 .ref-mount-node）。
 *
 * 连点多个节点要能累积（ISSUE #4547）：标记写入走「本地先定、服务端对账」
 * 的乐观同步（与 useIoModesCommit 同一模式）——先 setParamMap 更新编辑器
 * 本地 paramMap，再 savePatch 落库。只写服务端不更新本地时，下一次点击读到的
 * 还是旧名单，前一次的标记会被覆盖（只剩最后点的那一个），高亮与计数徽标也
 * 不会出现；顺带修掉「标记后点保存会以旧 paramMap 整份覆盖回库」的连带缺陷。
 */
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node } from "@xyflow/react";

import {
  referenceLoaderMountNodes,
  withReferenceLoaderMountNodes,
} from "~/lib/workshop/reference-loader-binding";
import type { WorkflowSaver } from "./use-workflow-save";

export type ReferenceMountModeController = {
  /** 加了高亮类的节点列表（传给画布）。 */
  decoratedNodes: Array<Node>;
  /** 画布节点单击：编辑态里切换节点的挂载标记（非编辑态下空操作）。 */
  handleNodeClick: (event: React.MouseEvent, node: Node) => void;
  /** 已标记的挂载节点 id（顶栏计数徽标 / 高亮判据）。 */
  mountedNodeIds: ReadonlyArray<string>;
  /** 编辑态是否激活（顶栏按钮 / 横幅据此渲染）。 */
  refMountMode: boolean;
  toggleRefMountMode: () => void;
};

export function useReferenceMountMode(args: {
  /** 当前视图的派生图（加高亮类后原样下发画布）。 */
  graphNodes: Array<Node>;
  paramMap: Record<string, unknown>;
  savePatch: WorkflowSaver;
  /** 编辑器本地 paramMap 的写回口：标记先同步到这里（乐观），随后落库。 */
  setParamMap: Dispatch<SetStateAction<Record<string, unknown>>>;
  workflowId: string;
}): ReferenceMountModeController {
  const { workflowId, paramMap, graphNodes, savePatch, setParamMap } = args;
  const [refMountMode, setRefMountMode] = useState(false);
  const mountedNodeIds = useMemo(() => referenceLoaderMountNodes(paramMap), [paramMap]);
  const toggleRefMountMode = useCallback(() => {
    setRefMountMode((value) => !value);
  }, []);
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!refMountMode) {
        return;
      }
      const current = referenceLoaderMountNodes(paramMap);
      const nextIds = current.includes(node.id)
        ? current.filter((id) => id !== node.id)
        : [...current, node.id];
      const nextParamMap = withReferenceLoaderMountNodes({ paramMap, nodeIds: nextIds });
      /* 本地先定（高亮 / 计数即时反映，下一次点击基于新名单累积），随后落库。 */
      setParamMap(nextParamMap);
      savePatch.mutate({ id: workflowId, paramMap: nextParamMap });
    },
    [refMountMode, paramMap, setParamMap, savePatch, workflowId],
  );
  const mountedSet = useMemo(() => new Set(mountedNodeIds), [mountedNodeIds]);
  const decoratedNodes = useMemo(
    () =>
      mountedSet.size === 0
        ? graphNodes
        : graphNodes.map((node) =>
            mountedSet.has(node.id) ? { ...node, className: "ref-mount-node" } : node,
          ),
    [graphNodes, mountedSet],
  );
  return {
    refMountMode,
    mountedNodeIds,
    toggleRefMountMode,
    handleNodeClick,
    decoratedNodes,
  };
}
