/* 工作流库「画布节点」预览的**连线图派生**（纯函数 + 常量，规范 §17.2 第①层）。
 *
 * 库里的三列（对外参数卡片列 + 宿主卡片 + 对外输出参数卡片列）此前是普通
 * DOM 并排摆放，连线由 `WorkflowParamWires` 量 rect 自绘 SVG —— 「能不能连」
 * 的判据（类型闸门 `pinAcceptsEntry`）藏在手势层，与画布上的 React Flow 语义
 * 各写一份。
 *
 * 现在三列各是一个 React Flow 节点（节点内部仍是普通 DOM，卡片与表单不变），
 * 连线是真正的 edge、端点是真正的 `<Handle>`，闸门收敛到 `isValidConnection`
 * 一个纯函数 —— 与编辑器画布同一套语义（ISSUE #529）。
 *
 * 本模块只产出**数据**：节点 id、边、以及 handle id 的换算规则；节点位置与
 * 视图模型由视图层摆（`use-library-wire-flow`）。
 *
 * 键空间（两个都必须分清，混了就「线画不出来」）：
 *   · **ioKey**（`<nodeId>::<kind>::<name>`）—— workflowIO 的字典键、落库的
 *     `paramMap.source.mode:<模式>` 的值、边的业务身份；
 *   · **handle id** —— DOM 上的端点标识。库里三列的端口一一对应，所以 handle
 *     id 直接用 ioKey（与项目画布的 `WidgetInputRow` 同口径）。
 */

import type { ReactNode } from "react";

import type {
  LibraryOutputCards,
  LibraryParamCards,
} from "./workflow-library-param-cards";

/** 三列各一个节点：左列对外参数卡片、中间宿主卡片、右列对外输出参数卡片。 */
export const LIB_NODE_PARAMS = "lib:params";
export const LIB_NODE_HOST = "lib:host";
export const LIB_NODE_OUTPUTS = "lib:outputs";

/** 边的业务身份：它连的是**哪个对外参数 / 哪个输出口**。
 *
 *  卡片上的圆点与线是同一份事实的两端，点选一条线要能反查出「点的是哪个口」
 *  —— 边 id 就是这条通道，视图据此让卡片与线一起高亮。 */
export const LIB_EDGE_PREFIX = "libwire";

/** 一条库内映射连线的身份（从边的 id 里取回）。
 *
 *  **必须带上 handle id**：一个对外参数可以**一对多**（「尺寸」的宽高比 /
 *  像素量 / 倍数各一条线，见 `wiredTargetsForEntry` 的 `allCandidates`），
 *  只用条目 id 会让三条线共用同一个 key（React 重复 key，点选高亮张冠李戴，
 *  且 React Flow 的 edgeLookup 会互相覆盖）。 */
export function libraryEdgeId(
  namespace: "param" | "output",
  entryId: string,
  handleId: string,
): string {
  return `${LIB_EDGE_PREFIX}:${namespace}:${entryId}?${handleId}`;
}

/** 从边 id 取回它属于哪个口（`null` = 不是库内映射线）。 */
export function libraryEdgeOwner(
  edgeId: string,
): { namespace: "param" | "output"; entryId: string; handleId: string } | null {
  const parts = edgeId.split(":");
  if (parts.length < 3 || parts[0] !== LIB_EDGE_PREFIX) return null;
  const namespace = parts[1];
  if (namespace !== "param" && namespace !== "output") return null;
  /* 条目 id 本身可能含 `:`（契约口 `reference-image-1` 不含，但历史键
   *  `<节点 id>|<分类>` 与自定义口可能含）—— 只切前两段，剩下的一整段里
   *  再按 `?` 分出「条目 id」与「handle id」（两者都可能含 `:`）。 */
  const rest = parts.slice(2).join(":");
  const sep = rest.indexOf("?");
  if (sep < 0) return null;
  return { namespace, entryId: rest.slice(0, sep), handleId: rest.slice(sep + 1) };
}

/** 一条库内边的两端锚点（来自映射表）。 */
export interface LibraryWire {
  /** 对外参数条目 id（输入侧）或输出口 ioKey（输出侧）。 */
  entryId: string;
  /** 输入侧：落点的 ioKey；输出侧：取值那一行的 ioKey。 */
  targetIoKey: string;
  namespace: "param" | "output";
  /** 作者改过（实线）—— 否则是自动判定的默认线（虚线）。 */
  manual: boolean;
}

/** 边的样式口径：自动判定画虚线、作者改过画实线（与编辑器画布同一套语义）。 */
export function libraryEdgeStyle(manual: boolean): {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
} {
  return manual
    ? { stroke: MANUAL_STROKE, strokeWidth: 2.5, opacity: 1 }
    : { stroke: AUTO_STROKE, strokeWidth: 2, strokeDasharray: "6 4", opacity: 0.75 };
}

/** 自动判定落点的描边色（与编辑器画布一致）。 */
export const AUTO_STROKE = "#64748b";
/** 作者改过的线的描边色。 */
export const MANUAL_STROKE = "#a78bfa";
/** 拖动中的预览线描边色（React Flow 的 connection line）。 */
export const DRAG_STROKE = "#c4b5fd";

/** 选中一条线时的高亮色（两侧卡片与线同时提亮）。 */
export const SELECTED_STROKE = "#c4b5fd";


/** 三列节点的首帧布局尺寸（px）。 */
export interface LibraryNodeSizing {
  /** 左列卡片宽度。 */
  paramsWidth: number;
  /** 右列卡片宽度。 */
  outputsWidth: number;
  /** 宿主卡片宽度（与项目画布节点同宽）。 */
  hostWidth: number;
  /** 三列之间的横向间距 —— 留出走线的空间，线不至于贴着卡片拐出尖角。 */
  columnGap: number;
  originX: number;
  originY: number;
}

/** 三列节点的布局：左列参数卡片 → 宿主卡片 → 右列输出卡片，横向排开。
 *
 *  这是**首帧**的位置：面板靠 `fitView` 把内容收进视口，位置只需单调可读。
 *  用户拖过的位置由 React Flow 自己持有（不受控画布）。 */
export function layoutLibraryNodes(
  sizing: LibraryNodeSizing,
): Record<string, { x: number; y: number }> {
  const { paramsWidth, hostWidth, columnGap, originX, originY } = sizing;
  return {
    [LIB_NODE_PARAMS]: { x: originX, y: originY },
    [LIB_NODE_HOST]: { x: originX + paramsWidth + columnGap, y: originY },
    /* 右列的位置与宿主卡片的**实测**宽度有关（卡片高度随行数变化，宽度固定），
     * 首帧用声明的宽度；画布 fitView 之后差值由用户感知不到。 */
    [LIB_NODE_OUTPUTS]: {
      x: originX + paramsWidth + columnGap + hostWidth + columnGap,
      y: originY,
    },
  };
}

/** 三列节点的**渲染内容**（`LibraryNodeContentContext` 下发的值）。
 *
 *  刻意放在本模块（纯类型 + 纯函数，无 React）：`hooks/use-library-wire-flow`
 *  要引用它的三段，而 hooks 不得 import `.tsx`（§17.2 的 H1 依赖倒置红线）。
 *  类型放在这里，两侧都只依赖一个 `.ts`。
 *
 *  为什么渲染内容**不进 `node.data`**：那会把「每帧都变的表单子树」塞进 React
 *  Flow 的状态里 —— 要么冻在首帧（表单永远停在未播种的那一帧），要么每帧
 *  `setNodes` 刷新它（setNodes → 重渲染 → setNodes 无限循环）。 */
export interface LibraryNodeContent {
  params: {
    cards: LibraryParamCards;
    canWire: boolean;
    selectedEntryId: string | null;
    onSelect: (entryId: string | null) => void;
    onReset: (entryId: string) => void;
  };
  host: { host: ReactNode };
  outputs: {
    cards: LibraryOutputCards;
    canWire: boolean;
    selectedOutputId: string | null;
    onSelect: (ioKey: string | null) => void;
    onReset: (ioKey: string) => void;
  };
}
