/* ── 项目画布的纯函数工具（第①层配置 / 第②层逻辑中的无副作用部分）──
 * 本文件只放「不产生网络请求、不读写外部状态」的派生函数，因此可以直接单测，
 * 也不受 UI/逻辑分离棘轮的 S1/S2 计数约束（见 docs/standards/17 §17.2）。
 *
 * 需要发请求的那部分（上传 / 启动生成 / 轮询任务 / LLM 扩写）已迁到同目录的
 * canvas-api.ts —— 那是第②层的网络部分，视图一律不得直接 fetch。
 */

import type { Edge, FitViewOptions, Node, XYPosition } from "@xyflow/react";
import { nextId } from "~/lib/unique-id";
import {
  type CanvasNodeType,
  type CanvasNodeData,
  isCanvasNode,
} from "./canvas-types";

/** 生成画布节点唯一 id（项目画布各创建入口共用，避免散落重复逻辑）。 */
export function makeNodeId(): string {
  /* 节点 id 也走全库唯一出口（规范 16 §16.2.4.36）：收口前这里是
   * 「毫秒数 + 4 位随机后缀」，与日志 / 消息中心 / 工坊那几处的形状都不同。
   * 节点 id 是**连线**的引用目标（`edge.source` / `edge.target`），撞 id 的
   * 表现是「新节点把旧节点的连线一起接管」。 */
  return nextId("n_");
}

/** 画布视口中心的屏幕坐标 —— 「没有落点信息时新节点放哪」的唯一出处。 */
export function viewportCenter(): XYPosition {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** 落点信息：拖放时的指针位置，或右键菜单的位置（**屏幕**坐标）。 */
export interface DropPoint {
  x: number;
  y: number;
}

/** 画布节点落地所需的上下文（由调用处从 React Flow 取，出口自己不持 ref）。 */
export interface CanvasPlacementContext {
  /** `useReactFlow().screenToFlowPosition` —— 屏幕坐标 → 画布坐标。 */
  screenToFlowPosition: (point: XYPosition) => XYPosition;
}

/**
 * 把一个画布节点放进项目画布 —— **全库唯一的入口**（规范 16 §16.2.4.38）。
 *
 * 收口前的三处（右键菜单两个入口、媒体拖放与「加入画布」按钮）各写一遍同样
 * 的四步，而每一步的判据都不一样：
 *
 * | 决定的               | 写法 A                                               | 写法 B                                              |
 * | -------------------- | ---------------------------------------------------- | --------------------------------------------------- |
 * | **落点从哪来**       | 拖放用指针（`e.clientX`），按钮用**视口中心**         | 右键菜单用手写菜单坐标（`menu.x` / `menu.y`）        |
 * | **`screenToFlowPosition` 的入参** | 有时传**屏幕**坐标（正确）              | 有时传**画布**坐标（错，节点会越点越远）             |
 * | **视口中心怎么算**   | `window.innerWidth / 2`                               | 两处**逐字相同**，第三处（工坊侧）用容器尺寸 —— 三份口径 |
 * | **节点数据怎么补**   | `{ ...defaultData(kind), 媒体字段 }`                  | 少写 `...defaultData(kind)` 会让新节点缺 20 个必需字段 |
 *
 * 出口把四步收成一次调用：**取落点 → 换算 → 组节点 → 追加**。
 * 「新节点带什么数据」仍由调用处给（`data` 是域判据：媒体节点带 `mediaPath`，
 * 工作流节点带 `workflowId`），出口只负责**基座**（id / type / position）。
 */
export function placeCanvasNode(opts: {
  /** 当前节点表（`setNodes` 的 updater 入参）。
   *
   *  ⚠️ 类型刻意取 React Flow 的 `Node[]` 而不是 `CanvasNodeType[]`：
   *  调用处的 `setNodes` 声明各式各样（`useNodesState<CanvasNodeType>` 给
   *  `CanvasNodeType[]`，`useReactFlow().setNodes` 给 `Node[]`），
   *  而出口**只做追加**、不读节点结构的任何字段 —— 收成 `CanvasNodeType[]`
   *  会逼着每个调用处写一句断言（eslint 又会把「不必要的断言」拦回去，
   *  两边互相打架）。 */
  nodes: Node[];
  /** 落点（**屏幕**坐标）；缺省落在视口中心。 */
  point?: DropPoint | null;
  /** **已经在画布坐标里**的落点 —— 当坐标本身来自画布（如「源节点右侧 340px」）
   *  时用它，出口就不再换算。与 `point` 二选一。 */
  flowPosition?: XYPosition | null;
  /** 画布坐标换算（`useReactFlow().screenToFlowPosition`）。 */
  flow: CanvasPlacementContext;
  /** 节点数据 —— 出口会把它铺在 `defaultData` 之上，缺字段由默认值兜住。 */
  data: CanvasNodeData;
  /** 显式指定 id —— 只在**调用处需要提前拿到它**时给（自动连线要用同一个
   *  id 建边：工作流跑完自动孵化下游节点时就是这种情形）。缺省由出口生成。 */
  id?: string;
}): CanvasNodeType[] {
  const position =
    opts.flowPosition ??
    opts.flow.screenToFlowPosition(opts.point ?? viewportCenter());
  const node: CanvasNodeType = {
    id: opts.id ?? makeNodeId(),
    type: "canvasNode",
    position,
    data: opts.data,
  };
  return [...opts.nodes, node] as CanvasNodeType[];
}

/** 双 rAF 的 fitView 调度器：等 ReactFlow 完成本轮布局后再 fit，
 *  替代脆弱的 setTimeout(80ms) 魔法数字（慢机器上可能布局未完成）。 */
export function makeFitViewScheduler(
  fitView: (options?: FitViewOptions) => void,
): (padding?: number) => void {
  return (padding = 0.25) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitView({ padding, duration: 300 });
      });
    });
  };
}

/** 连线传播的纯函数核心：根据 source 节点与出边，把上游数据写入下游节点。
 *  - workflow 节点：按 ioKey 写进 workflowInputs
 *  - picture / movie 内容载体：把上游 image 写入 mediaPath
 *  - 其余节点：按 targetHandle 分派 prompt/negative/steps/cfg/seed/inputImage
 *  workflowArdot 纯视觉节点无数据，直接跳过。 */
export function applyPropagationToNodes(
  nodes: CanvasNodeType[],
  sourceId: string,
  opts: {
    srcData: CanvasNodeData;
    outEdges: Edge[];
    importedFile: string | null;
  },
): CanvasNodeType[] {
  const { srcData: src, outEdges, importedFile } = opts;

  return nodes.map((node) => {
    if (node.id === sourceId) return node;
    if (!isCanvasNode(node)) return node;
    const edge = outEdges.find((outEdge) => outEdge.target === node.id);
    if (!edge) return node;
    const td = node.data;

    // 连线传入自定义工作流节点：按 ioKey 把上游输出写进 workflowInputs，
    // 这样 runGenerate 的 toWorkflowInputsPayload 会把它一起发给后端。
    if (td.kind === "workflow" && edge.targetHandle) {
      const key = edge.targetHandle;
      let stored: unknown = undefined;
      if (src.kind === "text" && src.content?.trim()) stored = src.content;
      else if (
        (src.kind === "picture" || src.kind === "movie") &&
        src.mediaPath
      )
        stored = src.mediaPath;
      else if (
        src.resultPath &&
        src.resultMediaType !== "video" &&
        importedFile
      )
        stored = importedFile;
      if (stored !== undefined) {
        return {
          ...node,
          data: {
            ...td,
            workflowInputs: { ...(td.workflowInputs ?? {}), [key]: stored },
            upstreamId: sourceId,
          },
        };
      }
      return node;
    }

    /* 上游产出写入 picture / movie 资产节点 — 当 target 是 picture 或 movie
     * 内容载体时，把 source 的 image (importedFile 优先于 src.mediaPath) 写到
     * target.mediaPath，让图片资产自动接收工作流生成的图作为内容；下游生图
     * 节点再从 picture 节点的 output Handle 接收这个 mediaPath，形成
     * 「工作流 → 图片资产 → 生图」完整链路。upstreamId 标记数据来源便于 UI
     * 后续显示「连线源：xxx 工作流」。 */
    if (td.kind === "picture" || td.kind === "movie") {
      const incoming: string | undefined =
        importedFile ??
        (src.kind === "picture" || src.kind === "movie"
          ? (src.mediaPath ?? undefined)
          : undefined);
      if (incoming) {
        return {
          ...node,
          data: {
            ...td,
            mediaPath: incoming,
            mediaName: src.resultPath
              ? String(src.resultPath).split(/[\\/]/).pop()
              : td.mediaName,
            upstreamId: sourceId,
          },
        };
      }
      return node;
    }

    const next: CanvasNodeData = { ...td };
    switch (edge.targetHandle) {
      case "prompt":
        // 文本载体节点喂它自己的自由文本；其它节点则喂 prompt 字段。
        if (src.kind === "text") {
          if (src.content?.trim()) next.prompt = src.content;
        } else if (src.prompt?.trim()) {
          next.prompt = src.prompt;
        }
        break;
      case "negative":
        if (src.negative?.trim()) next.negative = src.negative;
        break;
      case "steps":
        if (src.steps != null) next.steps = src.steps;
        break;
      case "cfg":
        if (src.cfg != null) next.cfg = src.cfg;
        break;
      case "seed":
        if (src.seed?.trim()) next.seed = src.seed;
        break;
      case "inputImage":
      default:
        if (importedFile) {
          next.inputImage = importedFile;
          next.upstreamId = sourceId;
          // 自动切换消费端模式，让喂进来的图片真正被用上
          if (next.kind === "image" && next.mode === "txt2img")
            next.mode = "img2img";
          if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
        } else if (
          (src.kind === "picture" || src.kind === "movie") &&
          src.mediaPath
        ) {
          // 内容载体本来就住在 ComfyUI 的 input 目录里，
          // 因此不必重新导入 —— 直接接上现成的文件名即可。
          next.inputImage = src.mediaPath;
          next.upstreamId = sourceId;
          if (next.kind === "image" && next.mode === "txt2img")
            next.mode = "img2img";
          if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
        }
        break;
    }
    return { ...node, data: next };
  });
}
