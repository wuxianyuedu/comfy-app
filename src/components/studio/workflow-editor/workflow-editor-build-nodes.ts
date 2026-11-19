/* 纯函数：接收派生上下文对象，返回 React Flow 节点数组。无 hook / 无组件状态，
 * useMemo 由调用方持有（见 wf-editor-inner.tsx 中的 buildInitialNodes 用法）。 */
import type { Node } from "@xyflow/react";
import { friendlyNodeTitle } from "~/lib/comfyui/node-titles";
/* 画布节点内部的层级不是视口刻度（规范 16 §16.2.5 第 3 条）：它们只在 React Flow
 * 的层叠上下文里互相比较。数值取自 Z.base（局部叠层下限），相对关系保持在
 * 本模块的常量里 —— 见下面 NODE_Z / SUBGRAPH_Z / NOTE_Z / GROUP_Z 的说明。 */
import { Z } from "~/lib/shell/overlay-z";
import { MODE_KEY_PREFIX } from "~/lib/workflow/workflow-param-mapping";
import type {
  RawInputMeta,
  ComfyGraphNode,
  WorkflowDetail,
  WorkflowNodeData,
} from "../workflow-types";
import type { RawNodeMeta } from "./workflow-editor-derived";
import {
  NODE_TITLE_H,
  computeKahnLayout,
  buildInputSources,
  buildConnectedOutputs,
  computeGroupDepths,
  extractNoteTitle,
  isNoteType,
} from "../workflow-utils";
import {
  IO_PORT_WIDTH,
  IO_PORT_HEIGHT,
  PORT_ROW_GAP,
  GROUP_PAD_X,
  GROUP_TITLE_BAR,
  GROUP_PAD_Y_BOTTOM,
  GROUP_RAIL_COLOR,
} from "./WorkflowEditorNodes";

/**
 * 画布节点内部的相对层级（**不是**视口刻度），只在本容器层叠上下文里比较：
 * 便签 / 组底板（常被节点压住的背景板）< 普通节点 < 子图卡片（紫色描边要读得出）
 * < 宿主内部的暴露口（必须浮在宿主卡片描边之上）。起点取 `Z.base`，逐档 +1。
 */
const GROUP_Z = Z.base;
const NOTE_Z = Z.base + 5;
const NODE_Z = Z.base;
const SUBGRAPH_Z = Z.base + 1;
const IO_PORT_Z = Z.base + 1;

/** `WorkflowDetail.graph` 的一个条目（从工作流原件派生的节点条目）。shared 的
 *  detail 类型把它声明成 `graph: Record<string, ApiWorkflowNode>`；这里在不改共享类型的
 * 前提下，把本文件这两处取用收窄。 */
type GraphEntry = { inputs?: WorkflowNodeData["inputs"] };
/** `detail.boundaryPins.inputs / .outputs` 里的一个边界 pin ——
 *  两个数组的元素形状相同。 */
type BoundaryPin = NonNullable<WorkflowDetail["boundaryPins"]>["inputs"][number];

export type BuildInitialNodesCtx = {
  detail: WorkflowDetail | null;
  /** 当前视图的宿主（外层封装）节点 id —— 仅当视图是「下钻后的子工作流内部」
   *  时传入。本层节点都是子图内部节点，勾选时把它一并带上，运行期据此还原
   *  comfy-cli 展开后的 `host:inner` 拼接 id（见 IoRef.hostNodeId）。 */
  hostNodeId?: string;
  onEnterSubgraph?: (
    id: string,
    classType: string,
    title: string,
    /** 本层视图的宿主链，嵌套下钻时与当前节点的 id 拼成新的宿主链。 */
    parentHostId?: string,
  ) => void;
  outSlotNameById: Record<string, Array<string>>;
  paramMap: Record<string, unknown>;
  rawMetaById: Record<string, RawNodeMeta>;
  scopeDetail: WorkflowDetail | null;
};

/** 边界 pin → wfGroup(wfIoPort …) 栏杆布局（从 `buildInitialNodes` 拆出，§12.13）
 * 每条栏杆各包一个紫色可拖拽 wfGroup（draggable + pointerEvents:auto + cursor:move），子节点带
 * parentId / extent:"parent" / draggable:false 随分组移动；间距 PORT_ROW_GAP(4px)、行高
 * IO_PORT_HEIGHT(22px)；位置经 `detail.positions["grp:bpin:…"]` 落库，已保存覆盖优先于包围盒兜底。
 */
/* IO 端口节点的尺寸是文件顶部的模块级常量（IO_PORT_HEIGHT /
 *  PORT_ROW_GAP / GROUP_*）—— 下面的布局过程与 WfIoPortNode 渲染器
 *  共用同一份，两边不会各自漂移。 */
/* ── 边界 pin → wfGroup(wfIoPort …) ──
 * 位置必须落在分组 `grp:bpin:*` 上：早先「一个 pin 一张卡片」把位置写进 positionsById
 *（空操作），于是每次刷新都退回包围盒锚定。
 */
const buildBoundaryPinNode = (
  pin: BoundaryPin,
  kind: "input" | "output",
  parentId: string,
  relY: number,
  relX: number,
): Node => ({
  id: `bpin:${pin.id}`,
  type: "wfIoPort",
  parentId,
  extent: "parent",
  position: { x: relX, y: relY },
  zIndex: IO_PORT_Z,
  draggable: false,
  selectable: true,
  connectable: false,
  style: { width: IO_PORT_WIDTH, height: IO_PORT_HEIGHT },
  data: {
    /* 显示名链路：边界 pin 的 `label`（作者业务名）**优先**，取不到回落 `localized`
     *（ComfyUI 的 i18n），最后兜底 `name` —— 标题永不为空；与 WfSubgraphNode.outputs.display
     * 同链路，两层渲染同一字符串，`name === type` 时 tooltip 补上解析出的类型以便区分。 */
    title: pin.label ?? pin.localized ?? pin.name ?? "",
    type: pin.type,
    direction: kind,
    parentNodeId: null,
    parentNodeTitle: "",
    connectsTo: null,
    connectsFrom: null,
  },
});
/* wfIoPort 在所属栏杆分组里的 X 锚点：输入标签在端口右侧、输出在左侧（镜像），各从
 * wfGroup 的**右上 / 左上角**锚定、而非同一条左边缘。早先输入侧贴死右边框
 *（`relX = 2 * GROUP_PAD_X`），`right:-4` 的 handle 露在框外（绿点溢出 Inputs 框）；
 * 故输入 relX = wfGroupWidth - IO_PORT_WIDTH - GROUP_PAD_X、输出 relX = GROUP_PAD_X，
 * handle（∓4）均落在框内 6px 处。 */
const wfGroupWidth = IO_PORT_WIDTH + 2 * GROUP_PAD_X;
const inputRelX = wfGroupWidth - IO_PORT_WIDTH - GROUP_PAD_X;
const outputRelX = GROUP_PAD_X;
/* 为整条栏杆建一个 wfGroup 节点。`draggable: true` 把 WfGroupNode 翻到
 *  交互模式（pointerEvents: auto、cursor: move），React Flow 会自动带上
 *  声明了 extent:"parent" 的子节点。高度这里**直接给** ——
 *  下面各行 pin 的纵向偏移是变化的，套不进早先那个
 *  `pinCount * IO_PORT_HEIGHT + (n-1)*PORT_ROW_GAP` 公式。 */
const buildBoundaryGroup = (
  id: string,
  title: string,
  pos: { x: number; y: number },
  height: number,
): Node | null => {
  if (height <= 0) {
    return null;
  }
  return {
    id,
    type: "wfGroup",
    position: pos,
    zIndex: GROUP_Z,
    draggable: true,
    selectable: true,
    connectable: false,
    data: { title, color: GROUP_RAIL_COLOR, draggable: true },
    style: { width: IO_PORT_WIDTH + 2 * GROUP_PAD_X, height },
  };
};
/* 算栏杆锚点，必要时回落到包围盒默认值；会话里已保存的分组位置优先尊重。
 * 两条栏杆不硬凑成包围盒对齐的一列，而是按 ComfyUI `boundaryPins.inputs[i].pos` /
 * `outputs[i].pos` 的原始坐标给每个分组锚定 —— 即未改动工作流里对应内部槽位端口的绝对
 * 位置（screenshot #2 所指）；仅当原始位置缺失或全 0 才回落包围盒（较旧 / 手搓的工作流）。
 * pin 的 y 按 `rawPinY - groupY` 推导，保住各行纵向间距。 */
function layoutBoundaryPins(
  detail: WorkflowDetail,
  middlePos: Record<string, { x: number; y: number }>,
): Array<Node> {
  if (!detail.boundaryPins) {
    return [];
  }
  const mIds = Object.keys(middlePos);
  if (mIds.length === 0) {
    return [];
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity;
  for (const id of mIds) {
    const p = middlePos[id];
    if (!p) {
      continue;
    }
    if (p.x < minX) {
      minX = p.x;
    }
    if (p.x > maxX) {
      maxX = p.x;
    }
    if (p.y < minY) {
      minY = p.y;
    }
  }
  /* 参考布局：┃ 左输入列 ┃ 中间画布列 ┃ 右输出列 ┃。
   *  每条栏杆与中间包围盒之间的空隙必须 ≥ 一个中间节点的宽度（约 280px）
   *  再加上一点呼吸余量，否则 wfIoPort 的标签会被埋进中间的 WfNode 卡片里。
   *  工作流带真实 pin.pos 坐标时（常见路径）**优先**走下面的原始 pin 锚定；
   *  这个 360px 的包围盒兜底只在所有 pin.pos 都缺失或为 0 时才生效。 */
  const RAIL_GAP = 360;
  const leftRailX = minX - RAIL_GAP;
  const rightRailX = maxX + RAIL_GAP;

  const rawPosOf = (pin: BoundaryPin): [number, number] | null => {
    if (Array.isArray(pin.pos) && pin.pos.length >= 2) {
      const x = Number(pin.pos[0]) || 0;
      const y = Number(pin.pos[1]) || 0;
      /* (0,0) 一律当作「没提供」—— 原件里没有该 pin 的位置时就是这个形态。
       *  回落到按包围盒锚定的栏杆，
       *  总好过把所有 pin 都堆在画布原点。 */
      if (x !== 0 || y !== 0) {
        return [x, y];
      }
    }
    return null;
  };
  const inputsRaw = detail.boundaryPins.inputs.map(rawPosOf);
  const outputsRaw = detail.boundaryPins.outputs.map(rawPosOf);
  /* 分组的默认锚点：取所有带真实原始位置的 pin 里最小的 x
   *  （输入取最左、输出取最右）与最小的 y，然后把分组原点往左上挪，
   *  让最上面那个 pin 落在标题栏 + 约 GROUP_PAD_X 之内。
   *  输入与输出是「朝内」的，所以左侧取 minX、右侧取 maxX。 */
  const computeGroupDefault = (
    list: Array<[number, number] | null>,
    side: "left" | "right",
  ): { x: number; y: number } | null => {
    let anchorX = side === "left" ? Infinity : -Infinity;
    let minRy = Infinity;
    let any = false;
    for (const p of list) {
      if (!p) {
        continue;
      }
      any = true;
      if (side === "left" ? p[0] < anchorX : p[0] > anchorX) {
        anchorX = p[0];
      }
      if (p[1] < minRy) {
        minRy = p[1];
      }
    }
    if (!any) {
      return null;
    }
    return {
      x: anchorX - GROUP_PAD_X,
      y: minRy - GROUP_TITLE_BAR - GROUP_PAD_X,
    };
  };
  const inputsDefault = computeGroupDefault(inputsRaw, "left");
  const outputsDefault = computeGroupDefault(outputsRaw, "right");

  const positionsById = detail.positions ?? {};
  const savedIn: [number, number] | undefined = positionsById["grp:bpin:inputs"];
  const savedOut: [number, number] | undefined = positionsById["grp:bpin:outputs"];

  const inputsGroupPos = savedIn
    ? { x: savedIn[0], y: savedIn[1] }
    : (inputsDefault ?? {
        x: leftRailX - GROUP_PAD_X,
        y: minY - GROUP_TITLE_BAR,
      });
  const outputsGroupPos = savedOut
    ? { x: savedOut[0], y: savedOut[1] }
    : (outputsDefault ?? {
        x: rightRailX - GROUP_PAD_X,
        y: minY - GROUP_TITLE_BAR,
      });

  const stackRel = (i: number) => GROUP_TITLE_BAR + i * (IO_PORT_HEIGHT + PORT_ROW_GAP);
  const inputsRelYs = detail.boundaryPins.inputs.map((_p, i) => {
    const r = inputsRaw[i];
    return r ? r[1] - inputsGroupPos.y : stackRel(i);
  });
  const outputsRelYs = detail.boundaryPins.outputs.map((_p, i) => {
    const r = outputsRaw[i];
    return r ? r[1] - outputsGroupPos.y : stackRel(i);
  });
  const minHeight = GROUP_TITLE_BAR + GROUP_PAD_Y_BOTTOM;
  const computedHeight = (relYs: Array<number>): number => {
    if (relYs.length === 0) {
      return 0;
    }
    return Math.max(minHeight, Math.max(...relYs) + IO_PORT_HEIGHT + GROUP_PAD_Y_BOTTOM);
  };

  const out: Array<Node> = [];

  const inputsGroup = buildBoundaryGroup(
    "grp:bpin:inputs",
    "Inputs",
    inputsGroupPos,
    computedHeight(inputsRelYs),
  );
  if (inputsGroup) {
    out.push(inputsGroup);
    /* `inputs` 与 `inputsRelYs` 是两个按位置配对的数组（前者是 pin 清单、
     * 后者是算出来的 y）。配对项缺席就跳过：`[i]!` 会把 `undefined` 冒充成
     * `number` 传给 `buildBoundaryPinNode`，坏的是一张画布。 */
    detail.boundaryPins.inputs.forEach((pin, i) => {
      const relY = inputsRelYs.at(i);
      if (relY === undefined) {
        return;
      }
      out.push(buildBoundaryPinNode(pin, "input", "grp:bpin:inputs", relY, inputRelX));
    });
  }

  const outputsGroup = buildBoundaryGroup(
    "grp:bpin:outputs",
    "Outputs",
    outputsGroupPos,
    computedHeight(outputsRelYs),
  );
  if (outputsGroup) {
    out.push(outputsGroup);
    detail.boundaryPins.outputs.forEach((pin, i) => {
      const relY = outputsRelYs.at(i);
      if (relY === undefined) {
        return;
      }
      out.push(buildBoundaryPinNode(pin, "output", "grp:bpin:outputs", relY, outputRelX));
    });
  }

  return out;
}

export function buildInitialNodes(ctx: BuildInitialNodesCtx): Array<Node> {
  const {
    detail,
    scopeDetail,
    rawMetaById,
    outSlotNameById,
    paramMap,
    onEnterSubgraph,
    hostNodeId,
  } = ctx;

  if (!detail) {
    return [];
  }
  if (!scopeDetail) {
    return [];
  }
  const colW = 300;
  const rowH = 220;
  const padX = 80;
  const padY = 80;

  // 按 id 给节点建索引，才能把 [srcId, slot] 形态的输入解析成源节点标题。
  const nodesById: Record<string, ComfyGraphNode> = {};
  for (const n of scopeDetail.nodes) {
    nodesById[n.id] = n;
  }

  /* 按 id 取每个节点的原始输入元数据（画布视图用） */
  const rawById: Record<string, Array<RawInputMeta>> = {};
  for (const n of scopeDetail.nodes) {
    rawById[n.id] = n.raw_inputs ?? [];
  }

  /* 「本节点 OUTPUT 槽馈入子图边界」的**独立**视图（取 `detail.boundaryLinks` 里
   * bl.kind === "output"）：服务端 `rawOutputs[].isBoundary` 盖章没传到（如命中旧
   * sessionStorage 缓存形状）时，作 WfNode hasDownstream 的备用信号让边界连线照样渲染。
   * v4 缓存修好后 RandomNoise 的 NOISE 输出 handle 仍被旧缓存掩过一次 —— 只挂服务端
   * 盖章会整条静默失效。顶层工作流的 boundaryLinks 为 undefined → 返回空 map。 */
  const boundaryOutputsByNodeId: Record<string, Set<string>> = {};
  /* 输入侧的镜像：bl.kind === "input" 把外层 pin 映射到「内部节点 + 输入槽名」。
   *  WfNode 用它把（rawInputs 里没有 `link` 的）widget 行标成边界行，
   *  这样陈旧缓存里缺 isBoundary 盖章时线也仍有落点。 */
  const boundaryInputsByNodeId: Record<string, Set<string>> = {};
  if (Array.isArray(detail.boundaryLinks)) {
    for (const bl of detail.boundaryLinks) {
      const nid = String(bl.innerNodeId);
      const slot = String(bl.innerSlotName || "");
      if (!nid || !slot) {
        continue;
      }
      if (bl.kind === "output") {
        (boundaryOutputsByNodeId[nid] ??= new Set()).add(slot);
      } else if (bl.kind === "input") {
        (boundaryInputsByNodeId[nid] ??= new Set()).add(slot);
      }
    }
  }

  /* rawMetaById + outSlotNameById 提到了上面（边的构建要用）。 */

  /* 预先算出每个节点有哪些输出被下游接了线。detail 加载时算一次就好 ——
   *  之后每个 WfNode / WfSubgraphNode 只需问一句「这个输出接了吗」，
   *  没接就把圆点藏掉，不必各自重扫一遍图。 */
  const connectedOutputsById = buildConnectedOutputs(
    scopeDetail,
    nodesById,
    rawMetaById,
    outSlotNameById,
  );

  // 真实 ComfyUI 图节点的共享构建器。锚点约定：React Flow `position` 是**卡片**左上角
  //（标题栏顶部），主体画在下方 NODE_TITLE_H(=30px)；ComfyUI `pos[1]` 是**主体**顶部，
  // 故 cardTop = bodyTop − 30，落库时 onNodeDragStop 反向加回，磁盘 `positions[id]`
  // 始终是「主体顶部」约定，反复保存不累出 30px 偏移。给 `n.size` 时外框 = size[0] /
  // `size[1] + NODE_TITLE_H`（size[1] 是主体内容高度，见 NODE_TITLE_H 注释）。
  const NODE_ANCHOR_OFFSET_Y = NODE_TITLE_H;
  /* SAFETY: 类型断言已复核 */
  const graphById = detail.graph as Record<string, GraphEntry | undefined>;
  const buildWfNode = (n: ComfyGraphNode, pos: { x: number; y: number }): Node => ({
    id: n.id,
    type: "wfNode",
    position: { x: pos.x, y: pos.y - NODE_ANCHOR_OFFSET_Y },
    style: n.size ? { width: n.size[0], height: n.size[1] + NODE_TITLE_H } : undefined,
    zIndex: NODE_Z,
    data: {
      nodeId: n.id,
      classType: n.class_type,
      /* 下钻到子图内部时，本层节点 id 都是内部 id（`1670`）；带上宿主 id
       * 让勾选能落库「外层 + 内层」两个 id（见 IoRef.hostNodeId）。 */
      hostNodeId,
      title: n.title,
      inputs: graphById[n.id]?.inputs ?? {},
      inputSources: buildInputSources(graphById[n.id]?.inputs, nodesById),
      assignedRole:
        Object.entries(paramMap).find(
          ([key, value]) => value === n.id && !key.startsWith(MODE_KEY_PREFIX),
        )?.[0] ?? null,
      rawInputs: n.raw_inputs ?? [],
      rawOutputs: rawMetaById[n.id]?.outputs ?? [],
      rawWidgetValues: rawMetaById[n.id]?.widgets_values ?? [],
      connectedOutputs: connectedOutputsById[n.id],
      /* 备用来源：从 detail.boundaryLinks 盖章，让还没带上
       *  rawOutputs[].isBoundary 盖章的节点（例如命中了 schema 变更之前
       *  的 detail 缓存形状）也照样挂上输出 Handle。这是一条**独立**通道 ——
       *  hasDownstream 经 `data.boundaryOutputs.has` 读它。 */
      boundaryOutputs: boundaryOutputsByNodeId[n.id],
      boundaryInputs: boundaryInputsByNodeId[n.id],
      flags: rawMetaById[n.id]?.flags ?? {},
      mode: rawMetaById[n.id]?.mode ?? 0,
      /* 子图路由盖的边界章。外层（顶层）工作流这两个恒为 false ——
       *  哨兵节点只存在于子图内部。客户端用这两个标记把每一簇节点包进
       *  INPUTS / OUTPUTS wfGroup，让用户在画布上看得见封装节点暴露的口
       *  最终落在了哪里。 */
      isInputEndpoint: n.is_input_endpoint === true,
      isOutputEndpoint: n.is_output_endpoint === true,
      /* LiteGraph 的 `properties`。透传给 WfNode，让 rgthree 的
       *  `Fast Groups Bypasser` 能读到 `matchTitle` 等并渲染出它自己的
       *  运行期开关清单。逐字透传。 */
      properties: rawMetaById[n.id]?.properties ?? {},
      /* 工作流分组。传给 WfNode，供 rgthree 的运行期主体比对；
       *  其它节点忽略这个字段。这里传的是**同一份引用**而不是克隆 ——
       *  节点数与工作流规模无关地把成本压在 O(1)。 */
      groups: detail.groups ?? [],
      size: n.size ? { w: n.size[0], h: n.size[1] } : undefined,
    },
  });

  /* 子图封装节点：class_type 是 UUID，ComfyUI 经 proxyWidgets 暴露输入，每个槽位带
   * localised_name。父卡片**不再**渲染 IO 行，而是紧凑的「统计 + 下钻入口」芯片（见
   * WfSubgraphNode）；下钻（双击 / 头部展开按钮）才加载内部图，其 IO 成员节点包进
   * INPUTS / OUTPUTS wfGroup。 */
  const buildSubgraphNode = (n: ComfyGraphNode, pos: { x: number; y: number }): Node => {
    /* 有**外部**连线的子图输入，就是父工作流接进来的那些。判据取自
     *  detail.graph[子图节点id].inputs —— 这里的键，只要值是
     *  [srcId, slot] 元组，就算已连接。 */
    const subgraphInp = graphById[n.id]?.inputs ?? {};
    const connectedInputs = new Set<string>();
    for (const [name, v] of Object.entries(subgraphInp)) {
      if (Array.isArray(v) && typeof v[0] === "string") {
        connectedInputs.add(name);
      }
    }
    return {
      id: n.id,
      type: "wfSubgraph",
      // 锚点约定与 buildWfNode 相同（见构建器上方的注释）：
      // 卡片顶部 = 配置里的主体顶部 − NODE_TITLE_H，
      // 主体因此正好落在导入的 pos.y 上。
      position: { x: pos.x, y: pos.y - NODE_ANCHOR_OFFSET_Y },
      zIndex: SUBGRAPH_Z, // 画在普通节点之上，紫色描边才读得出来
      style: n.size ? { width: n.size[0], height: n.size[1] + NODE_TITLE_H } : undefined,
      data: {
        nodeId: n.id,
        /* 本层若是「子图内部的子图」，本卡片自身就是下一层的宿主，其内部
         *  勾选由下一层的 hostNodeId 表达；本层卡片的暴露口（boundary pin）
         *  仍属于当前视图，故沿用当前视图的 hostNodeId。 */
        hostNodeId,
        title: friendlyNodeTitle(n.class_type, n.title, "zh"),
        uid: n.class_type.slice(0, 8),
        inputs: n.raw_inputs ?? [],
        outputs: rawMetaById[n.id]?.outputs ?? [],
        widgetValues: rawMetaById[n.id]?.widgets_values ?? [],
        connectedOutputs: connectedOutputsById[n.id],
        connectedInputs,
        size: n.size ? { w: n.size[0], h: n.size[1] } : undefined,
        mode: rawMetaById[n.id]?.mode ?? 0,
        onEnter: () => onEnterSubgraph?.(n.id, n.class_type, n.title, hostNodeId),
      },
    };
  };

  /* ── 分组框（背景层，在所有内容之后）── */
  const groups = detail.groups ?? [];
  const groupDepth = computeGroupDepths(groups);
  /* ComfyUI 分组 id 是裸整数，既可能撞图节点 id，也可能**彼此**撞车（子图 `groups`
   * 数组合法允许重复 id，如同一个内部图里出现两次 "32"）。`group:` 前缀只挡前者，后者会让
   * <MiniMapNodes> 报 `Encountered two children with the same key, "group:32"`。
   * 这里按已用 id 去重、撞车补 `-${i}` 后缀；`groupDepth`（以原始 g.id 为键）与
   * WfGroupNode 的 data.title/color 都不受影响。 */
  const usedGroupIds = new Set<string>();
  const groupNodes: Array<Node> = groups
    .filter((group) => group.bounding[2] > 0 && group.bounding[3] > 0)
    .map((group) => {
      const [x, y, w, h] = group.bounding;
      let nodeId = `group:${group.id}`;
      let dupIdx = 0;
      while (usedGroupIds.has(nodeId)) {
        dupIdx += 1;
        nodeId = `group:${group.id}-${dupIdx}`;
      }
      usedGroupIds.add(nodeId);
      return {
        id: nodeId,
        type: "wfGroup",
        position: { x, y },
        // 嵌套越深 zIndex 越高，但始终在便签 / 节点之下
        zIndex: GROUP_Z + 1 + Math.min(groupDepth[group.id] ?? 0, 3),
        draggable: false,
        selectable: false,
        connectable: false,
        data: { title: group.title, color: group.color },
        style: { width: w, height: h, pointerEvents: "none" },
      };
    });

  /* ── 便签 / MarkdownNote 注释节点 ── */
  const notes = detail.notes ?? [];
  const noteNodes: Array<Node> = notes.map((note) => {
    const title = extractNoteTitle(note.text, note.title);
    /* 锚点约定（与图节点相同）：React Flow 的 `position` 是卡片顶部
     *  （标题栏顶部），主体在它下面 NODE_TITLE_H 处。要让**主体**顶部落在
     *  导入的 `pos[1]` 上，带标题的便签就要减去 NODE_TITLE_H；
     *  无标题便签不画标题栏，主体就是整张卡片，不需要偏移。
     *  便签的 onNodeDragStop 在落库前把 NODE_TITLE_H 加回来。 */
    const noteHasTitle = !!title;
    return {
      id: `note:${note.id}`,
      type: "wfNote",
      position: {
        x: note.pos[0],
        y: note.pos[1] - (noteHasTitle ? NODE_ANCHOR_OFFSET_Y : 0),
      },
      zIndex: NOTE_Z,
      draggable: true,
      selectable: true,
      connectable: false,
      data: { title, text: note.text, color: note.color },
      /* ComfyUI / litegraph 载荷里的 `size` 存的是**主体内容**高度
       *  （30px 标题栏**不含**在 `size[1]` 里，见 NODE_TITLE_H 的注释）。
       *  带标题的便签要在原始内容高度上再加一层标题栏，因此它的 React Flow
       *  外框是 `size[1] + NODE_TITLE_H`；无标题便签不画标题栏，
       *  `size[1]` 本身就是完整高度。 */
      style: {
        width: note.size[0],
        height: note.size[1] + (noteHasTitle ? NODE_TITLE_H : 0),
      },
    };
  });

  // 只处理真实的图节点（便签类节点在上面单独渲染）。
  const realNodes = scopeDetail.nodes.filter((node) => !isNoteType(node.class_type));

  /* 内层的图节点一律渲染成完整的 WfNode / WfSubgraphNode 卡片 ——
   *  不再按 is_input_endpoint / is_output_endpoint 把某些节点换成 wfIoPort。
   *  那种做法在「每个节点同时带两个标记」的子图上直接塌掉，
   *  而参考布局本身要求内层节点**保持**完整卡片。 */
  /* ── 1) Saved positions ──
   * 守卫空 `{}`（空对象 truthy，「重置布局」可产出）：没有守卫每个节点都会落到
   * `{padX, padY}` 全堆在原点；同理位置数 < realNodes.length 视为「快照不存在」，整图跑
   * Kahn 给可预期的网格布局（只摆过一两个节点时 100+ 个会叠在同一卡片后）。「混着来」
   * 更乱：自动布局假定画布为空，半摆好的节点会打乱最长路径分层，兜底反而更难看。 */
  // 单一格式（不再区分 RAW / API 视图）。节点布局优先使用
  // detail.positions（已含 rawJson 原始位置 + 用户拖拽覆盖），不足时退回
  // Kahn 拓扑自动布局兜底。
  const kahn = computeKahnLayout(realNodes, scopeDetail.graph, { colW, rowH, padX, padY });

  const savedPositions = scopeDetail.positions;
  const positionsCount = Object.keys(savedPositions ?? {}).length;

  const useSavedPositions =
    savedPositions !== null &&
    savedPositions !== undefined &&
    positionsCount > 0 &&
    positionsCount >= realNodes.length;
  if (useSavedPositions && Boolean(savedPositions)) {
    const positionsById = savedPositions;
    const middleNodes = realNodes.map((realNode) => {
      const p = positionsById[realNode.id];
      return realNode.is_subgraph === true
        ? buildSubgraphNode(realNode, p ? { x: p[0], y: p[1] } : { x: padX, y: padY })
        : buildWfNode(realNode, p ? { x: p[0], y: p[1] } : { x: padX, y: padY });
    });
    /* SAFETY: 类型断言已复核 */
    const middlePosById = Object.fromEntries(
      middleNodes.map((middleNode) => [middleNode.id, middleNode.position]),
    ) as Record<string, { x: number; y: number }>;
    return [
      ...groupNodes,
      ...noteNodes,
      ...middleNodes,
      ...layoutBoundaryPins(detail, middlePosById),
    ];
  }

  /* 3: hybrid — 「部分 saved-positions」兜底：positions 不足以覆盖 realNodes（典型：含
   * 子图 wrapper 时服务端早期只提了顶层 pos，wrapper 内 17 个节点漏了；extractPositions
   * 已修，理论上不再走到）时不要整图退回 Kahn —— 已匹配节点用真实 LiteGraph pos，
   * 未匹配的复用上面算好的 kahn 排到独立区域（紧贴第一行下方），已定位的不乱跳、
   * 新增的不堆在 (padX, padY)。 */
  if (positionsCount > 0 && savedPositions) {
    const positionsById = savedPositions;
    const middleNodes = realNodes.map((realNode) => {
      const saved = positionsById[realNode.id];
      const kahnPos = kahn[realNode.id];
      let pos: { x: number; y: number };
      if (saved) {
        pos = { x: saved[0], y: saved[1] };
      } else if (kahnPos) {
        pos = kahnPos;
      } else {
        pos = { x: padX, y: padY };
      }
      return realNode.is_subgraph === true
        ? buildSubgraphNode(realNode, pos)
        : buildWfNode(realNode, pos);
    });
    /* SAFETY: 类型断言已复核 */
    const middlePosById = Object.fromEntries(
      middleNodes.map((middleNode) => [middleNode.id, middleNode.position]),
    ) as Record<string, { x: number; y: number }>;
    return [
      ...groupNodes,
      ...noteNodes,
      ...middleNodes,
      ...layoutBoundaryPins(detail, middlePosById),
    ];
  }

  /* ── 2) Auto-layout via Kahn longest-path ── (raw 视图兜底，复用上面算好的 kahn) */
  const middleNodes = realNodes.map((realNode) => {
    const pos = kahn[realNode.id] ?? { x: padX, y: padY };
    return realNode.is_subgraph === true
      ? buildSubgraphNode(realNode, pos)
      : buildWfNode(realNode, pos);
  });
  /* SAFETY: 类型断言已复核 */
  const middlePosById = Object.fromEntries(
    middleNodes.map((middleNode) => [middleNode.id, middleNode.position]),
  ) as Record<string, { x: number; y: number }>;
  return [
    ...groupNodes,
    ...noteNodes,
    ...middleNodes,
    ...layoutBoundaryPins(detail, middlePosById),
  ];
}
