/* 工作流库「画布节点」预览的**连线图派生**（纯函数 + 常量，规范 §17.2 第①层）。
 * 三列各是一个 React Flow 节点（内部仍是普通 DOM），连线是真 edge、端点是真
 * `<Handle>`，闸门收敛到 `isValidConnection` 一个纯函数（ISSUE #529）。本模块只产出
 * 数据：节点 id、边与 handle id 换算。键空间必须分清：ioKey（字典键/落库值/边身份）
 * 与 handle id（DOM 端点标识）；库内三列端口一一对应，故 handle id 直接用 ioKey。 */

import type { ReactNode } from "react";

import type { LibraryOutputCards, LibraryParamCards } from "./workflow-library-param-cards";

/** 三列各一个节点：左列对外参数卡片、中间宿主卡片、右列对外输出参数卡片。 */
export const LIB_NODE_PARAMS = "lib:params";
export const LIB_NODE_HOST = "lib:host";
export const LIB_NODE_OUTPUTS = "lib:outputs";

/** 三列共用的一层**透明背景板**（铺满面板可视高度，见 `LibraryNodeSizing.fillHeight`）。
 *
 *  它唯一的职责是把画布的缩放下限钉住，让 `fitView` 不会在「卡片比视口矮」时
 *  只放大到内容高度、把画布底边以下留成面板底色（ISSUE #596）。因为不承载内容、
 *  也没有端口，抬高它不会影响任何端点几何 —— 三列节点的声明高度继续照实给。 */
export const LIB_NODE_BACKDROP = "lib:backdrop";

/** 本仓自建的四个固定节点 id。 */
export type LibNodeId =
  | typeof LIB_NODE_PARAMS
  | typeof LIB_NODE_HOST
  | typeof LIB_NODE_OUTPUTS
  | typeof LIB_NODE_BACKDROP;

/** 三列 + 背景板的坐标表。**四个键都有值**（不是索引签名）——
 *  读取端因此不必再对 `at[id]` 补 `!`。 */
export type LibNodeLayout = Record<LibNodeId, { x: number; y: number }>;

/** 边的业务身份：它连的是**哪个对外参数 / 哪个输出口**。
 *
 *  卡片上的圆点与线是同一份事实的两端，点选一条线要能反查出「点的是哪个口」
 *  —— 边 id 就是这条通道，视图据此让卡片与线一起高亮。 */
export const LIB_EDGE_PREFIX = "libwire";

/** 一条库内映射连线的身份（从边的 id 里取回）。
 *
 *  **必须带上 handle id**：一个对外参数可以一对多（「尺寸」的宽高比 / 像素量 /
 *  倍数各一条线），只用条目 id 会让三条线共用同一个 key（React 重复 key、高亮
 *  张冠李戴，React Flow 的 edgeLookup 也会互相覆盖）。 */
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
): { entryId: string; handleId: string; namespace: "param" | "output" } | null {
  const parts = edgeId.split(":");
  if (parts.length < 3 || parts[0] !== LIB_EDGE_PREFIX) {
    return null;
  }
  const namespace = parts[1];
  if (namespace !== "param" && namespace !== "output") {
    return null;
  }
  /* 条目 id 本身可能含 `:`（契约口 `reference-image-1` 不含，但历史键
   *  `<节点 id>|<分类>` 与自定义口可能含）—— 只切前两段，剩下的一整段里
   *  再按 `?` 分出「条目 id」与「handle id」（两者都可能含 `:`）。 */
  const rest = parts.slice(2).join(":");
  const sep = rest.indexOf("?");
  if (sep === -1) {
    return null;
  }
  return {
    namespace,
    entryId: rest.slice(0, sep),
    handleId: rest.slice(sep + 1),
  };
}

/** 一条库内边的两端锚点（来自映射表）。 */
export type LibraryWire = {
  /** 对外参数条目 id（输入侧）或输出口 ioKey（输出侧）。 */
  entryId: string;
  namespace: "param" | "output";
  /** 输入侧：落点的 ioKey；输出侧：取值那一行的 ioKey。 */
  targetIoKey: string;
};

/** 作者画过的线的描边色。 */
export const MANUAL_STROKE = "#a78bfa";
/** 库里一条边的样式：**一律是作者画过的线**（实线）。
 *
 *  库里不画「猜出来的」默认线（用户口径：编辑对外参数时「未连过就不要连」）；
 *  默认落点仍算在 `resolved` 里（卡片与运行期读它），只是不在画布上画虚线占位。 */
/* SAFETY: 类型断言已复核 */
export const LIBRARY_EDGE_STYLE = {
  stroke: MANUAL_STROKE,
  strokeWidth: 2.5,
  opacity: 1,
} as const;
/** 拖动中的预览线描边色（React Flow 的 connection line）。 */
export const DRAG_STROKE = "#c4b5fd";

/** 选中一条线时的高亮色（两侧卡片与线同时提亮）。 */
export const SELECTED_STROKE = "#c4b5fd";

/** 三列节点的首帧布局尺寸（px）。 */
export type LibraryNodeSizing = {
  /** 三列之间的横向间距 —— 留出走线的空间，线不至于贴着卡片拐出尖角。 */
  columnGap: number;
  /* ── 两套高度尺寸，ISSUE #596「全屏时下方空白不是画布」：fitView 按节点并集包围盒
   *  缩放，内容比视口矮时只放大到内容高度、底边以下落回面板底色。`envelopeHeight`
   *  仅作首帧声明尺寸（jsdom 量不到 DOM 会一条边都不画）；`fillHeight` 是透明背景板
   *  高度 max(视口, 卡片列)，把最优缩放钉在「铺满视口」。不抬高卡片：声明尺寸会被当
   *  作端点几何依据（圆点算偏），且 `height` 钉死外框后端点坐标不再重算；板无端口。 */
  /** 三列内容节点的**首帧**包络高度（px）。
   *
   *  必须走 `initialHeight` 声明（不是 `height`）：内容由卡片撑开，量到尺寸后这一层
   *  声明即撤、外框改由内容决定 —— 见 `buildLibraryNodes` 里那段坑的说明。 */
  envelopeHeight: number;
  /** 背景板的渲染高度（px）：面板可视高度与卡片列高度取大。 */
  fillHeight: number;
  /** 宿主卡片宽度（与项目画布节点同宽）。 */
  hostWidth: number;
  originX: number;
  originY: number;
  /** 右列卡片宽度。 */
  outputsWidth: number;
  /** 左列卡片宽度。 */
  paramsWidth: number;
};

/** 三列节点的布局：左列参数卡片 → 宿主卡片 → 右列输出卡片，横向排开。
 *
 *  这是**首帧**的位置：面板靠 `fitView` 把内容收进视口，位置只需单调可读。
 *  用户拖过的位置由 React Flow 自己持有（不受控画布）。 */
export function layoutLibraryNodes(sizing: LibraryNodeSizing): LibNodeLayout {
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
    /* 背景板从三列的左上角起铺（它比三列都大，位置对包围盒没有影响）。 */
    [LIB_NODE_BACKDROP]: { x: originX, y: originY },
  };
}

/* ── 背景板几何（纯函数，可单测）────────────────────────────────────────
 * 两层尺寸都由「视口」与「内容」取大，缺一都会退回那块空白：
 *   · 宽 —— 面板窄时三列会横向溢出，画布要跟到三列右缘（右列不可见 = 线断了）；
 *   · 高 —— 面板高时画布要铺到面板底边（用户报的就是这一条）。
 * 两者都加一点留白，免得内容正好贴死在背景板边缘上。 */

/** 背景板四周的留白（px）：内容与视口边界之间留一口气。 */
export const BACKDROP_PADDING = 120;

/** 三列的包围盒（含列宽与列间距），背景板至少要盖住它。 */
export function libraryContentExtent(sizing: LibraryNodeSizing): {
  height: number;
  width: number;
} {
  const { paramsWidth, hostWidth, outputsWidth, columnGap, envelopeHeight } = sizing;
  return {
    width: paramsWidth + hostWidth + outputsWidth + columnGap * 2,
    height: envelopeHeight,
  };
}

/** 背景板尺寸：视口与内容取大，各加 `BACKDROP_PADDING`。 */
export function libraryBackdropSize(
  sizing: LibraryNodeSizing,
  viewport: { height: number; width: number },
): { height: number; width: number } {
  const content = libraryContentExtent(sizing);
  const clamp = (viewportSide: number) => Math.max(1, Math.round(viewportSide));
  return {
    width: Math.max(content.width, clamp(viewport.width)) + BACKDROP_PADDING,
    height: Math.max(content.height, clamp(viewport.height)) + BACKDROP_PADDING,
  };
}

/** 三列节点的**渲染内容**（`LibraryNodeContentContext` 下发的值）。
 *  放在本模块（纯类型 + 纯函数，无 React）：hooks 不得 import `.tsx`（§17.2 的
 *  H1 依赖倒置红线），两侧都只依赖一个 `.ts`。渲染内容不进 `node.data`：那会把
 *  每帧都变的表单子树塞进 React Flow 状态，要么冻在首帧，要么每帧 `setNodes`
 *  刷新它（setNodes → 重渲染 → setNodes 无限循环）。 */
export type LibraryNodeContent = {
  host: { host: ReactNode };
  outputs: {
    canWire: boolean;
    cards: LibraryOutputCards;
    onReset: (ioKey: string) => void;
    onSelect: (ioKey: string | null) => void;
    selectedOutputId: string | null;
  };
  params: {
    canWire: boolean;
    cards: LibraryParamCards;
    /** 该模式生效的契约口清单（卡片头取名与「工坊封装」页签同一份）。 */
    contractEntries: ReadonlyArray<{ id: string; label: string }>;
    onReset: (entryId: string) => void;
    onSelect: (entryId: string | null) => void;
    selectedEntryId: string | null;
  };
};
