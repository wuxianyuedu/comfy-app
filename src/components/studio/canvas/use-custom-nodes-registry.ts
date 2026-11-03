"use client";
/* 自定义节点注册表的外部 store 订阅（FlowNode 这类 React.memo 读方专用）。
 * 不用上层 state 下传：memo 穿不进，而 PackageFooter 包名与调试渲染链读的是就地替换的可变 map
 *（「解析完不重进页面就不更新」是结构性的）。不用 Context：读表组件跨三个页面、
 * ReactFlow 又在我们外面渲染节点，订阅挂在真正读它的组件上最小且不漏。
 * getSnapshot 负责挂载首读（事件不重放，最早灌入在挂载 effect 里、订阅尚未建立）；订阅放本文件、不放派发方以避免自环广播。 */
import { useSyncExternalStore } from "react";

import { getCustomNodesRegistryVersion } from "~/config/custom-nodes";
import { subscribeAppEvent } from "~/lib/app-events";

/**
 * 稳定的 subscribe 引用。`useSyncExternalStore` 按引用比较 subscribe；
 * 内联箭头函数会每次渲染退订再订阅（订阅数 × 节点数）。
 */
function subscribeRegistry(onChange: () => void): () => void {
  return subscribeAppEvent("comfyapp:custom-nodes-updated", onChange);
}

/**
 * 订阅注册表的灌入广播，返回灌入版本号。
 *
 * 调用方不读这个数 —— 调用本身就是「这一次渲染要重算表里的东西」的信号。
 */
export function useCustomNodesRegistryVersion(): number {
  return useSyncExternalStore(
    subscribeRegistry,
    getCustomNodesRegistryVersion,
    getCustomNodesRegistryVersion,
  );
}
