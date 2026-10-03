"use client";
/* 自定义节点注册表的外部 store 订阅（FlowNode 这类被 React.memo 包住的读方专用）。
 *
 * 为什么不是「上层 bump 一个 state 再往下传」：`FlowNode` 是 `React.memo` 的，
 * 父层重渲染穿不进它的记忆化，而它下面两个读注册表的地方 —— `PackageFooter` 的
 * 包名（`resolveNodePackage`）与调试态的渲染链模块标签（`getWorkflowRenderChainModules`）
 * —— 读的都是 `~/config/custom-nodes` 里那两个**就地替换**的可变 map。
 * 于是「解析完不重进页面就不更新」是结构性的：表换了，读它的组件没被告知。
 *
 * 为什么用外部 store 而不是 Context：Context 要挑一个 Provider 位置，而读这张表的
 * 组件跨三个页面（工作流画布 / 项目画布 / 设置面板预览），ReactFlow 又在我们外面
 * 自己渲染节点；订阅挂在**真正读它的那个组件**上，才是最小且不会漏的形状。
 *
 * `useSyncExternalStore` 的 `getSnapshot` 就是「挂载时先读一次」那一口 —— 事件本身
 * 不排队重放（见 `~/lib/app-events`），而最早的一次灌入发生在画布挂载的 effect 里，
 * 那一刻订阅还没建立；快照读让首屏即使错过那次广播也拿到当前版本。
 *
 * 订阅也刻意不放进 `~/config/custom-nodes`（派发方在那儿）：派发与订阅同文件就是
 * 自己给自己广播，两端成对的判据会被这种自环糊过去。 */
import { useSyncExternalStore } from "react";

import { getCustomNodesRegistryVersion } from "~/config/custom-nodes";
import { subscribeAppEvent } from "~/lib/app-events";

/**
 * 稳定的 subscribe 引用。
 *
 * `useSyncExternalStore` 按引用比较 subscribe —— 写成传内联箭头函数会每次渲染都
 * 退订再订阅（订阅数与节点数相乘，白做一遍）。
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
