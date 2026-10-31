/**
 * 画布持久化的**形状**（`nodes` / `edges` 两个字段），不依赖 `@xyflow/react`。
 *
 * ## 为什么单独一个文件（规范 §12.19）
 *
 * `canvas-store.ts` 只做 localStorage 读写，它需要的是「一个节点长什么样」。
 * 此前它 import 的是画布域的 `canvas-types.ts`（转手 import 了 ReactFlow 的
 * `Node`）与 `Edge` —— 而**类型 import 在打包器看来仍是一条模块边**。于是
 * 「只做 JSON 存取」的持久化层被画布引擎钉在静态图上，而入口
 * `src/app/workspace/page.tsx` 正是静态 import 它的（取 `createProject` 这类
 * 纯操作）。实测这条链是入口静态图里**唯一**还牵着 `@xyflow/react` 的一跳。
 *
 * 拆出来之后：持久化只认这两个别名（结构上与 `Node` / `Edge` 兼容），画布业务
 * 代码继续用 `CanvasNodeType` / ReactFlow 的 `Node`。判据
 * `scripts/check-barrel-heavy-deps.cjs`。
 *
 * ⚠️ 别把这两个别名当成「画布节点类型」到处用 —— 它们是**存储形状**，
 * 业务代码要结构化读写请用 `canvas-types.ts` 里的那一套。
 */
import type { CanvasNodeData } from "./canvas-types";

/** 持久化里的一个节点（结构上兼容 ReactFlow 的 `Node`）。 */
export interface PersistedNode {
  [key: string]: unknown;
  data: CanvasNodeData;
  id: string;
  position: { x: number; y: number };
  /** ReactFlow 的节点类型名（`canvasNode` / `workflowArdot`）——取联合字面量
   *  而不是 `string`：读取侧要把值交回 `CanvasNodeType`，写成 `string` 接不住。 */
  type: "canvasNode" | "workflowArdot";
}

/** 持久化里的一条边（结构上兼容 ReactFlow 的 `Edge`）。 */
export interface PersistedEdge {
  [key: string]: unknown;
  id: string;
  source: string;
  target: string;
}
