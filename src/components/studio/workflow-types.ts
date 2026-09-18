/* 抽出的类型声明 —— 原本声明在 WorkflowCanvasEditor.tsx 内部。
 * 这里只有纯类型声明，没有运行期代码。
 * 下面的 `import type` 只在编译期存在（完全擦除）——复用服务端 API 图的节点
 * 形状，让 detail.graph 的消费方仍能拿到 class_type / inputs 访问器，
 * 不必退化成 any。 */
import type { ApiWorkflowNode } from "~/lib/comfyui/raw";
import type { WorkflowIOModeOverride } from "~/lib/workflow/workflow-io-types";

/* ── 类型定义 ── */
export interface RawInputMeta {
  /** ComfyUI 输入名（英文字段名）。 */
  name: string;
  /** 可读的英文标签（可选）。 */
  label?: string;
  /** ComfyUI 的简体中文本地化标签（可选，显示时优先用它）。 */
  localized?: string;
  /** ComfyUI 数据类型 —— MODEL、CLIP、IMAGE、INT、FLOAT 等。 */
  type: string;
  /** 该槽位已被上游连线占用时为真。 */
  isConnection: boolean;
  /** 该槽位由边界哨兵连线馈入时为真（子图暴露口的输入/输出线 ——
   *  origin_id=-10 / target_id=-20）。内部节点侧仍以 `link` 携带这条线，
   *  但它的值并不绑定到某个真实源节点 id；因此这一行**外观上仍是 widget**，
   *  却必须挂一个 target Handle 让边界线有落点。
   *  见 `WorkflowCanvasEditor` 的致命坑第 5 条。 */
  isBoundary?: boolean;
  /** ComfyUI 封装节点的 widget 代理。凡是**背后有内部 widget** 的输入才有，
   *  纯连线输入没有。WorkflowSubgraphNode 用它把 `VALUE` 单元格渲染在标签右侧，
   *  配色规则与 WorkflowNode 一致（`valueCellColor`）。 */
  widget?: { name: string };
  /** 预先配好的 widget 值（字符串/数字/布尔）。配对下标是「inputs[] 里排在
   *  这一行之前的 widget 个数」，与 ComfyUI 的 `widgets_values[]` 顺序对齐。
   *  `widget` 不存在时为 undefined（即纯连线行 —— 内部节点的值不经封装节点
   *  暴露出来）。 */
  widgetValue?: unknown;
  /** 服务端盖上的 `multiline` 标记 —— 驱动 WorkflowNode /
   *  WorkflowSubgraphNode 里的 `isStringWidget`：上游 Python `INPUT_TYPES()`
   *  声明为 multiline 的 STRING 输入一律渲染成多行文本框，
   *  与默认值多短无关。
   *
   *  由服务端用「静态 (classType, name) 表 + 长度启发式」算出：我们拿到的
   *  API 格式 rawJson **不保留**原始 widget 配置（没有 `widgets[]` /
   *  `inputs[]`）。widget 规格里没有 `multiline` 提示时同样会盖章 ——
   *  启发式只标「确定是 multiline」，不盖 = 「没有意见」。 */
  multiline?: boolean;
  /** 当这个 IMAGE 输入由 LoadImage 一族的上游节点馈入时，服务端解析出上游
   *  上传的文件名并盖在这里，画布便能经 /api/images 代理渲染内联缩略图。
   *
   *  **适用范围已收窄** —— 只盖在服务端为 LoadImage 节点本身推送的那条
   *  合成 `preview: true` 条目上；下游的 IMAGE 输入（ImageScale /
   *  CLIPVisionEncode 等）不再携带它：在那里显示未缩放 / 未编码的上游图会
   *  误导用户。合成预览条目自身也可能是 undefined —— widgets_values[0] 缺失
   *  （没上传图）时渲染器回落到「需要上传图片」占位，保证节点主体始终有预览位。 */
  imageRef?: { filename: string; subfolder: string; type: string };
  /** 合成 LoadImage 预览条目的标记。
   *  渲染器会把它从 connEntries 与 widgetEntries **两侧**都过滤掉，
   *  因此它永远不会画成端口圆柱或普通 widget 控件 —— 只由专属的
   *  <WorkflowImagePreview> 尾部块消费。这样 LoadImage 的主体保持干净
   *  （左侧不会为合成的 `image` 条目多出一个假输入柱），
   *  也保证预览 / 占位的渲染只有一个来源。 */
  preview?: boolean;
  /** 子工作流封装节点暴露口背后的「内部真实字段」（服务端由
   *  `properties.proxyWidgets` 解析后随条目下发）。
   *
   *  wrapper 的槽位名是本层自动编号的别名（`value_1`），业务名在内部节点
   *  上。画布与 IO 面板都按「内部字段 label → localized → 字段名」取名，
   *  避免同一 pin 在两处显示成不同字符串（ISSUE #349）。普通节点不携带。 */
  proxyField?: {
    nodeId: string;
    field: string;
    label?: string;
    localized?: string;
  };
}

export interface ComfyGraphNode {
  id: string;
  class_type: string;
  title: string;
  /** class_type 是 UUID 时为真（ComfyUI 子图封装节点）。 */
  is_subgraph?: boolean;
  /** 每个输入的显示元数据，来自原始 JSON（localized_name + type）。 */
  raw_inputs?: RawInputMeta[];
  /** ComfyUI / litegraph 节点的精确外框尺寸 [宽, 高]。导入时没带原始尺寸
   *  （纯 API 导入）则为 undefined —— 客户端回落到按内容驱动的布局。
   *  `h` **只算主体**：30px 的标题栏画在外框之上，不含在这里面。 */
  size?: [number, number];
  /** 该节点任一输入槽从子图的输入哨兵节点（-10）收到连线时为真 ——
   *  表示它位于当前子图的 INPUTS 边界上。由
   *  /api/workflows/[id]/subgraph 路由盖章，客户端据此把这些节点包进
   *  一个 INPUTS wfGroup，不必再走一遍连线表。
   *  外层（顶层）工作流永远不会为真 —— 那里的每个节点都只是普通节点。 */
  is_input_endpoint?: boolean;
  /** 该节点任一输出槽馈入子图的输出哨兵目标（-20）时为真 ——
   *  表示它位于 OUTPUTS 边界上。与 `is_input_endpoint` 对称。 */
  is_output_endpoint?: boolean;
  /** 边界输入口的细节，供 wfIoPort 渲染（v3）。
   *  只在 `is_input_endpoint` 为真时设置。由子图路由从哨兵 -10 连线 +
   *  配对的 widget 值里取出。 */
  boundary_input?: { name: string; type: string; value: unknown } | null;
  /** 边界输出口的细节，供 wfIoPort 渲染。
   *  只在 `is_output_endpoint` 为真时设置。 */
  boundary_output?: { name: string; type: string } | null;
  /** 本端点的输出在内部**馈入**的第一个非哨兵中间节点（对 INPUT 端点而言）。
   *  客户端据此把 wfIoPort 摆在这个中间节点旁边。 */
  connects_to?: string | null;
  /** 本端点的输入在内部**来自**的第一个非哨兵中间节点（对 OUTPUT 端点而言）。
   *  与 connects_to 对称。 */
  connects_from?: string | null;
}

/** IO 编辑模式下勾选出来的一个暴露参数。`ioKey` 是对象的键
 *  （`${nodeId}::${kind}::${name}`）；值记录它是什么，这样最终的工作流 IO
 *  摘要不必重走一遍图就能拼出来。 */
export interface WorkflowIOParam {
  direction: "input" | "output";
  kind: "param" | "widget" | "output";
  nodeId: string;
  name: string;
  /** 作者在 IO 面板里显式重命名的显示名（**唯一**写入点是面板的 ✎ 改名框）。
   *
   *  勾选 IO 那一刻画布透传的名字不再进库：它本来就是画布从同一个 raw 槽位
   *  读出来的名字，抄一份下来只会在两处口径不一致时固化出一个陈旧名字。
   *  因此这里没有值 = 作者没重命名过，显示名走富化链
   *  （`ioLabel(e) = e.label ?? e.name` 之外还含子图内部业务名）。
   *  刻意不从 `data.title` 播种 —— 节点标题在同节点的兄弟 pin 之间是共用的
   *  （一个 T2I 节点上的 `text` / `text_1` 会拿到同一个标题），那样 IO 摘要
   *  反而没法看。 */
  label?: string;
  /* ── 服务端富化字段（GET /api/workflows/[id]）──
   * 刚在本地勾选出来的条目上没有它们（勾选框只写四个身份字段）；服务端会在
   * 下一次读取时从 raw_inputs / rawNodes.outputs 重新推导，
   * 因此这里一律按可选对待。 */
  /** ComfyUI 数据类型："STRING" | "INT" | "FLOAT" | "BOOLEAN" | "IMAGE" 等。 */
  type?: string;
  /** 当前 widget 值 / 图里的字面量，用于预填动态表单。 */
  defaultValue?: unknown;
  /** 所属节点的标题 —— 用来区分不同节点上的同名 pin。 */
  nodeTitle?: string;
  /** 应渲染成多行文本框而非单行的 STRING 输入。 */
  multiline?: boolean;
  /** `WorkflowIOEntry.required` 的镜像字段。只在 `kind === "widget"` 时有意义
   *  —— 在 IO 编辑模式里切换，下一次 PATCH 落库。 */
  required?: boolean;
  /** 用户自定义的显示顺序，由 IO 编辑预览的拖拽排序手势写入。镜像
   *  `WorkflowIOEntry.displayOrder`；排序契约见 workflow-io.ts。
   *  与 `workflowIO` 的其余部分在同一次 PATCH 里落库。 */
  displayOrder?: number;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random）。
   *  镜像 `WorkflowIOEntry.seedMode`，随 workflowIO 一起 PATCH 落库。 */
  seedMode?: string;
  /** 多模式：按模式码的覆盖层。镜像 `WorkflowIOEntry.modes`，
   *  落在同一个 workflowIO JSON 列里（因此新增模式无需改表）。由 IO 预览面板的
   *  「模式页签」编辑，随整体 workflowIO 一起 PATCH 落库。 */
  modes?: Record<string, WorkflowIOModeOverride>;
  /** 宿主（外层封装）节点 id。仅在「下钻到子工作流内部」勾选时写入：此时
   *  `nodeId` 是子图内部节点 id（`1670`），运行期 comfy-cli 展开后是 `4:1670`
   *  （宿主 id + 内部 id），两个 id 都存下来才能在运行期确定性还原。 */
  hostNodeId?: string;
  /** 本层槽位上作者写的业务名（服务端富化下发，与槽位名不同才有值）。
   *
   *  事实字段：富化链把它排在 `localized` 之后（通用翻译会盖住它），所以显示
   *  名算不到它；想按「作者在本层槽位上写的名字」取名时只有这里有。 */
  slotLabel?: string;
}

/** 用于切换 IO 暴露状态的一次参数引用。
 *
 *  只带**身份字段**：显示名不进库（画布行上的名字与 IO 面板里的名字都由富化链
 *  一处给，抄一份下来只会在两处口径不一致时固化出陈旧名字）。作者想改名走
 *  IO 面板的 ✎ 改名框（`setIOLabel`）。 */
export interface IoRef {
  nodeId: string;
  name: string;
  kind: "param" | "widget" | "output";
  direction: "input" | "output";
  /** 宿主（外层封装）节点 id：当前视图是子工作流内部时，由画布把「从哪一层
   *  钻进来」的宿主 id 一并带上，落库后运行期据它还原 `host:inner` 拼接 id。 */
  hostNodeId?: string;
}

/** 共享 context：让每个自定义节点（WorkflowNode / WorkflowSubgraphNode）都能读到
 *  当前 IO 编辑模式与实时勾选集合，而不必在每次切换时重建节点的 `data`。
 *  切换只在这里更新 `workflowIO` 状态，所有消费节点经 context 直接重渲染。 */
export interface IOEditContextValue {
  ioEditMode: boolean;
  workflowIO: Record<string, WorkflowIOParam>;
  toggleIO: (ref: IoRef) => void;
  /** 更新某个已勾选 pin 的显示名。新值存在 `workflowIO[key].label` 上，
   *  下一次 `handleSave` 落库（现有 PATCH 体本来就整份发送 `workflowIO`）。
   *  键不在表里时是空操作 —— 显示名只存在于已勾选的 pin 上。 */
  setIOLabel: (key: string, label: string) => void;
  /** 翻转已勾选 widget 输入的 `required` 标记。
   *  只在本地翻转（不新增 IOEdit 模式状态）；它与 toggleIO / setIOLabel
   *  改的是同一条 `workflowIO[key]` 记录，因此共用同一条落库路径
   *  （下一次 PATCH 整份发送）。键不在表里时是空操作 ——
   *  required 只对已勾选的 pin 有意义。 */
  toggleIORequired: (key: string) => void;
  /** IO 预览里的拖拽排序：把 `fromKey` 移到渲染列表中 `beforeKey` 的正前方
   *  （传 `null` 表示移到末尾）。会重排受影响分组的 `displayOrder` 并即时
   *  PATCH 服务端，让排列能扛过一次刷新。密集编号策略与分组隔离契约见
   *  `reorderIO` 的实现。 */
  reorderIO: (fromKey: string, beforeKey: string | null) => void;
}
export interface RgthreeGroupsContextValue {
  /** 某个分组 id 的**生效**旁路状态（本地覆盖 > detail）。 */
  getBypass: (groupId: string) => boolean;
  /** 翻转分组的旁路状态；PATCH 服务端并设置本地覆盖。 */
  setBypass: (groupId: string, bypass: boolean) => void;
}
export interface NodeJsonViewerRequest {
  /** 触发浮层的 `#id` 芯片的 `DOMRect`。用户点下时抓取一次，随后在浮层
   *  存续期间冻结 —— 否则重渲染（或平移/缩放）会在阅读过程中把它拖着走。 */
  anchorRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  /** ComfyUI 工作流 JSON 的键 —— `data.nodeId`。子图**同样是**这个键
   *  （子图封装节点是 `graph` 里的顶层条目，不是嵌套的）。 */
  nodeId: string;
  /** 视觉区分（影响浮层的强调色与芯片配色回显）。 */
  kind: "node" | "subgraph";
}
export interface NodeJsonViewerContextValue {
  /** 取原始的 `detail.graph[nodeId]` 条目。纯读 —— `detail` 还没加载
   *  （顶栏「加载中…」状态）或该键不存在（例如被完整装饰过的节点，
   *  其 API 形态省略了这条记录）时返回 `null`。 */
  getNodeJson: (nodeId: string) => Record<string, unknown> | null;
  /** 更富的查询，供浮层「节点视图」合成页签使用 —— 把逐字节一致的图条目、
   *  原始 UI 元数据（按 id 匹配的 `detail.rawNodes[i]`）与画布位置
   *  （`detail.positions[id]`）打包在一起。纯 API 导入时 `raw` 与 `pos`
   *  分别是 `undefined` / `null`。 */
  getNodeView: (nodeId: string) => {
    entry: Record<string, unknown> | null;
    raw:
      | {
          widgets_values: unknown[];
          outputs: RawOutputMeta[];
          flags: Record<string, unknown>;
          properties: Record<string, unknown>;
          mode: number;
        }
      | undefined;
    /** 原始 RAW 节点（`detail.rawJson.nodes[i]`）—— 与整个工作流 RAW 视图
     *  里对应的那一片逐字节一致。工作流是纯 API 导入（没有 rawJson）
     *  或找不到该节点时为 `null`。 */
    rawNode?: Record<string, unknown> | null;
    pos: [number, number] | null;
  } | null;
  /** 打开浮层。`anchorEl` 应是那个 `#id` 芯片元素（只用于定位 ——
   *  指针事件是在浮层挂载**之后**才落到它上面的，
   *  因此这里同步抓一次矩形）。 */
  requestShow: (
    anchorEl: HTMLElement,
    nodeId: string,
    kind: "node" | "subgraph",
  ) => void;
  /** 手动关闭。ESC 与点击外部都会调它。 */
  dismiss: () => void;
  /** 实时浮层状态 —— Provider 只把它暴露给浮层组件本身；
   *  下游消费方通常只需要 requestShow / getNodeJson。 */
  viewer: NodeJsonViewerRequest | null;
}
export type RawMetaEntry = {
  widgets_values: unknown[];
  outputs: RawOutputMeta[];
  flags: Record<string, unknown>;
  properties: Record<string, unknown>;
  mode: number;
};

export interface WorkflowDetail {
  id: string;
  name: string;
  taskType: string;
  /** 多模式：该工作流可运行的全部模式码（模板 modes 列解析），与库详情的
   *  「类型」同源；IO 预览面板的模式页签从这里取。子图变体缺省。 */
  modes?: string[];
  defaultMode?: string | null;
  graph: Record<string, ApiWorkflowNode>;
  /** 从 `/api/workflows/:id` 返回的原始导入格式 (LiteGraph
   *  JSON)；canvas 顶部「📋 查看 JSON」modal 直接读这里喂给 SourceModal。
   *  null 表示该工作流纯 API 导入，无原始格式。 */
  rawJson?: unknown;
  nodes: ComfyGraphNode[];
  /** RAW 视图专用数据包（从 rawJson 派生、保留 subgraph
   *  wrapper）。当存库 `graph` 被拆平成 N:xx 节点时，RAW 布局据此渲染原始
   *  ComfyUI 节点（含 wrapper 紫色整卡），而非炸开的 API 图。null = 无 rawJson。 */
  rawView?: {
    nodes: ComfyGraphNode[];
    positions: Record<string, [number, number]> | null;
    graph: Record<string, ApiWorkflowNode>;
  } | null;
  paramMap: Record<string, string>;
  /** 用户挑出来的暴露集合：ioKey → 元数据。ioKey =
   *  `${nodeId}::${kind}::${name}`。只有在用户打开 IO 编辑模式并勾选参数后
   *  才有内容；空对象表示「什么都没暴露」。 */
  workflowIO: Record<string, WorkflowIOParam>;
  /** { nodeId: [x, y] } —— 只在原始导入时设置；只给了 API JSON 时为 null。 */
  positions: Record<string, [number, number]> | null;
  /** ComfyUI 分组框（原始 UI 格式）。bounding = [x, y, w, h]。 */
  groups: WorkflowGroup[] | null;
  /** 便签 / MarkdownNote 注释节点（原始 UI 格式）。 */
  notes: WorkflowNote[] | null;
  /** 稀疏的原始节点元数据 —— 只有 `id`、`widgets_values` 与 `outputs[]`。
   *  WorkflowSubgraphNode 用它取 widget 值；WorkflowNode 与
   *  WorkflowSubgraphNode 在离线类型表不认得该类时用它渲染 OUTPUT 端口条
   *  （例如 ResolutionSelector 这类自定义节点，或输出只能从原始 JSON 里
   *  发现的子图 UUID）。 */
  rawNodes:
    | {
        id: string;
        widgets_values: unknown[];
        outputs: RawOutputMeta[];
        /** 每个节点的 LiteGraph 标记（如 `collapsed`）。原始数据缺失
         *  （纯 API 导入）时为空。Flow 侧原本经 `(rn as any).flags` 消费它们；
         *  在这里声明是为了让 JSON 浮层能在合成的「节点视图」页签里展示。 */
        flags?: Record<string, unknown>;
        /** 自定义节点属性（例如 rgthree 的 `Fast Groups Bypasser`
         *  从这里读 `matchTitle`）。原始数据缺失时为空。 */
        properties?: Record<string, unknown>;
        mode?: number;
      }[]
    | null;
  /** 边界 pin 实体（来自 ComfyUI 原始的 subgraph.inputs/outputs）。
   *  每个 pin 有自己的 UUID、名字、类型、保存位置，以及指向跨边界连线的
   *  linkIds。它们在内层画布里渲染成一列整洁的紧凑 wfIoPort 节点
   *  —— 左侧放输入、右侧放输出。 */
  boundaryPins?: {
    inputs: {
      id: string;
      name: string;
      type: string;
      localized?: string;
      label?: string;
      pos: [number, number];
      linkIds: number[];
    }[];
    outputs: {
      id: string;
      name: string;
      type: string;
      localized?: string;
      label?: string;
      pos: [number, number];
      linkIds: number[];
    }[];
  };
  /** 把带哨兵的连线翻译成 (pin ↔ 内部节点槽位) 配对 —— `buildEdges` 用它
   *  在边界 pin 的 handle 与内部节点对应的输入/输出 handle 之间生成
   *  React Flow 边。 */
  boundaryLinks?: {
    linkId: number;
    kind: "input" | "output";
    pinId: string;
    innerNodeId: string;
    innerSlotName: string;
  }[];
  /** 该工作流由本地文件支撑（经「本机路径」导入）时的绝对路径。
   *  文件一变，服务端就重新导入。 */
  sourcePath?: string | null;
  /** 本次 detail GET 检出并应用了源文件变更时设置。 */
  sourceChanged?: boolean;
  /** 被跟踪的源文件在磁盘上已不存在时设置。 */
  sourceMissing?: boolean;
  /** 分类："local" = 文件支撑；"online" = 粘贴 / API 导入。 */
  source?: "local" | "online";
}

export interface RawOutputMeta {
  name: string;
  localized?: string;
  /** 槽位的业务标签 —— `FRAMES` / `IMAGE_FINAL`。由 /api/workflows/[id]
   *  从 rawJson.outputs[].label 透传，让父级 WorkflowSubgraphNode 的输出条
   *  与内层 WorkflowIoPortNode 的 IO 栏显示同一个名字。 */
  label?: string;
  type: string;
  /** 从这个输出出去的源连线 id（用来推导连线）。 */
  links: number[];
  /** 至少有一条出边指向边界哨兵 `-20` 时为真（该输出被父级子图封装节点
   *  暴露出去）。由 /api/workflows/[id]/subgraph 盖章。外层工作流恒为 false。 */
  isBoundary?: boolean;
}

export interface WorkflowGroup {
  id: string;
  title: string;
  bounding: [number, number, number, number];
  color: string;
  /** 分组旁路状态。镜像 `rawJson.groups[i].flags.bypass`，也是 rgthree
   *  Fast Groups Bypasser 集成用的抓手：点该节点主体里的开关会翻转这个字段
   *  并 PATCH 回服务端。读取时缺省为 false。 */
  bypass?: boolean;
}

export interface WorkflowNote {
  id: string;
  /** 显示标题 —— 从 `title` 字段或第一行 `#` 标题里取出。 */
  title: string;
  text: string;
  pos: [number, number];
  size: [number, number];
  color: string;
}

/** 从便签的原始 JSON 里取出显示标题。ComfyUI 把标题存在根级（较新版本），
 *  或者写成正文里的第一行 markdown 标题（`# 标题`）。没有 markdown 标题时
 *  回落到第一个非空行，连它都没有则回落成 ""。开头的 "Note:" 前缀会被剥掉，
 *  否则标题栏会回显成 "Note: Note: Foo"。 */
export interface WorkflowNodeData {
  [key: string]: unknown;
  nodeId: string; // ComfyUI 节点 ID
  classType: string;
  title: string;
  inputs: Record<string, unknown>;
  /** 该节点被指派了哪个端口角色（如果有） */
  assignedRole: string | null;
  /** 对每个「连线型」输入（[srcId, slot]），记录源节点的 title 与
   *  class_type。用于渲染 "← <源节点> #xx" 标签，并推断线上流动的数据类型。 */
  inputSources: Record<
    string,
    { id: string; title: string; slot: number; classType?: string }
  >;
  /** 每个输入的显示元数据，来自原始 JSON（localized_name + type）。 */
  rawInputs?: RawInputMeta[];
  /** 该节点是当前子图的 INPUT 端点时为真（它的输入槽从子图 -10 哨兵
   *  接收）。由 /api/workflows/[id]/subgraph 盖章。外层工作流恒为 false。
   *  客户端据此把这簇节点包进一个 INPUTS wfGroup，
   *  让用户看得见父级封装节点的输入是从哪里流进子图的。 */
  isInputEndpoint?: boolean;
  /** 该节点是 OUTPUT 端点时为真（它的输出馈入子图 -20 哨兵）。
   *  与 `isInputEndpoint` 对称。 */
  isOutputEndpoint?: boolean;
  /** 每个输出的显示元数据，来自原始 JSON（localized_name + type +
   *  下游连线 id）。inferOutputTypeAll 认不出该类时用它
   *  （例如 ResolutionSelector 这类自定义节点）。 */
  rawOutputs?: RawOutputMeta[];
  /** 馈入子图边界的输出槽**名字**集合 —— 从 `detail.boundaryLinks`
   *  （kind === "output"）推导。与 `rawOutputs[].isBoundary` **各自独立**：
   *  sessionStorage 缓存未命中、拿不到最新 detail 形状时，
   *  画布也不会因此黑掉。顶层（非子图）工作流恒为空。 */
  boundaryOutputs?: Set<string>;
  /** 来自子图边界 pin 的输入槽**名字**集合 —— 输入侧的
   *  `boundaryOutputs`。与 `rawInputs[].isBoundary` 各自独立：
   *  即使陈旧缓存里的 detail 缺了服务端的输入盖章，
   *  WorkflowNode 也仍会为边界连线挂上输入 Handle。 */
  boundaryInputs?: Set<string>;
  /** 与 `rawInputs` 配对的 widget 值，用于 API `inputs` 映射为空的自定义
   *  节点（导入管线把自定义节点的 widget 值存在 rawJson.widgets_values 里，
   *  而不是折进 `graph[id].inputs`）。设置之后，WorkflowNode 以 rawInputs
   *  作为输入来源，并按位置从这个数组取值。 */
  rawWidgetValues?: unknown[];
  /** 在本工作流里至少有一条下游边的输出**名字**（与
   *  `inferOutputTypeAll(classType)` 的键或 `rawOutputs[i].name` 对应）。
   *  WorkflowNode 只为名字出现在这里的输出行渲染 source Handle ——
   *  「没有线就没有圆点」。为 undefined / 空集时渲染器把所有输出都当成
   *  未被使用（不挂 Handle）。 */
  connectedOutputs?: Set<string>;
  /** 每个节点的 LiteGraph 标记，逐字透传自原始 JSON（对 SetNode /
   *  rgthree Compact 这类折叠 widget，ComfyUI 会写
   *  `flags.collapsed: true`）。编辑器读 `flags.collapsed`，
   *  有它就折叠芯片主体。其余键（pinned、allow_interaction 等）
   *  原样保留，留给将来用。 */
  flags?: Record<string, unknown>;
  /** LiteGraph 的 `mode` 值（0 = Always / 正常，2 = Never / 静音，
   *  4 = Bypass）。从原始 JSON 透出，让画布按 ComfyUI 状态给节点上色 ——
   *  旁路 → 紫色，禁用 → 灰色，正常 → 角色色 / 默认色。 */
  mode?: number;
  /** rawJson 里的 LiteGraph `properties` 字典。那些在运行期由这些值推导
   *  自身主体 UI 的自定义前端会用它 —— 最典型的例子是 rgthree 的
   *  `Fast Groups Bypasser`，它读 `matchTitle` / `matchColors` / `sort`
   *  等来算出自己的开关清单。`classType === "Fast Groups Bypasser
   *  (rgthree)"` 时 WorkflowNode 会看 `properties.matchTitle`，
   *  把匹配到的分组渲染成运行期主体。不带 properties 的节点为空 /
   *  undefined。 */
  properties?: Record<string, unknown>;
  /** 工作流分组。透传给 WorkflowNode，让 rgthree Fast Groups Bypasser
   *  的运行期主体不必重新拉取就能与实时分组列表比对。这里是**只读**的 ——
   *  切换分组旁路要走 `RgthreeGroupsContext.setBypass` → PATCH，
   *  而不是直接改。 */
  groups?: WorkflowGroup[];
  /** ComfyUI 的精确外框尺寸 { w, h }（只算主体，不含标题栏）。
   *  有值时卡片被强制成这个尺寸，不再走按内容驱动的 min/max 宽度布局。
   *  undefined → 按内容驱动。 */
  size?: { w: number; h: number };
  /** 当前视图的宿主（外层封装）节点 id —— 仅当视图是「下钻后的子工作流内部」
   *  时由编辑器注入（值 = 进入本层时的 wrapper 节点 id）。
   *
   *  本层节点都是子图内部节点（id 形如 `1670`），在顶层画布上不存在；勾选它们
   *  时 `IoRef.nodeId` 会带上 `hostNodeId`，运行期据此把内部 id 还原成 comfy-cli
   *  展开后的 `4:1670` 拼接形式。顶层视图不注入（undefined）。 */
  hostNodeId?: string;
}

/** 分组数据。行尺寸用于把 target Handle 摆在每个输入行旁边。 */
export interface WorkflowGroupData {
  [key: string]: unknown;
  title: string;
  color: string;
  /** 为真时分组成为真正可拖拽的单元：pointerEvents 翻成 auto、光标提示
   *  抓取即移动，任何声明了 `parentId: this.id` + `extent:"parent"` 的
   *  React Flow 子节点都会同步移动。为 false / undefined 时分组只是后层的
   *  纯装饰（指针穿透到下面的节点与边）—— 也就是 ComfyUI 自己那些
   *  `group` 矩形的历史行为。 */
  draggable?: boolean;
}

export interface WorkflowIoPortData {
  [key: string]: unknown;
  title: string;
  type?: string;
  value?: unknown;
  direction: "input" | "output" | "both";
  parentNodeId: string;
  parentNodeTitle: string;
  /** 本端点（输入侧）馈入的第一个中间节点 —— 用来在左列把端口与它的消费方
   *  纵向对齐。 */
  connectsTo?: string | null;
  /** 馈入本端点（输出侧）的第一个中间节点 —— 用来在右列把端口与它的产出方
   *  纵向对齐。 */
  connectsFrom?: string | null;
}

/* 边界 pin 的 wfIoPort 卡片布局常量。
 *
 *  这些 pin 住在 INPUTS / OUTPUTS 的 wfGroup 矩形里，渲染成一叠纵向排列的
 *  紧凑标签行。三个值决定这一列的视觉节奏：调大 IO_PORT_HEIGHT 会让整条栏杆
 *  变矮，调大 PORT_ROW_GAP 让 pin 之间更松散，IO_PORT_WIDTH 决定最长的标签
 *  能有多宽才被裁掉。
 *
 *  高度取 28 而不是 22：22px 时 React Flow 的节点外框会把 `p` `g` `y` `q`
 *  这类带下伸笔画的字母**裁掉约 1~2px**。10.5px 字体的「上伸 + 大写字高 +
 *  下伸」叠起来本就超过 22px，一旦在 `py-[1px]` 的行里用
 *  `flex items-center` 居中，节点的 `style.height = IO_PORT_HEIGHT`
 *  就把外框变成硬裁剪盒。抬到 28px 并配 `leading-[1.4]`（行盒 14.7px，
 *  内部含上下留白）后，下伸部分落在 28px 外框内的 y ≈ 10px 处，
 *  底部留出 4~5px 余量；整条 wfGroup 只涨约 18px（10 行时），
 *  仍然在「紧凑」的要求之内。
 *
 *  这条尺寸链被来回调过几次，结论只有一个：**下伸笔画被裁是「行盒高度」
 *  与「外框高度」两个量共同决定的**，只调其中一个（例如把对齐从
 *  items-center 改成 items-end）改不动它 —— 行盒本身不包含下伸部分时，
 *  对齐方式怎么改都会被 `style.height` 裁掉。所以最终的两处修改是
 *  「行盒高度（leading-[1.4]）」+「外框高度（28）」成对调整。
 *
 *  若以后觉得行距太松，可换回 leading-snug（1.375）并把
 *  IO_PORT_HEIGHT 收到 26 —— 两个值必须一起动。 */
export interface WorkflowNoteData {
  [key: string]: unknown;
  title: string;
  text: string;
  color: string;
}

export interface WorkflowSubgraphData {
  [key: string]: unknown;
  /** ComfyUI 的真实节点 id（与 `detail.graph[id]`、`rawMetaById[id]`、
   *  `positions[id]` 对应）。由 initialNodes 构建器盖章，
   *  让 `#id` 芯片能像 `WorkflowNodeData.nodeId` 那样查到条目 ——
   *  这里若用 `data.uid`（classType 前 8 位）会永远查不中，
   *  因为那是哈希值，不是 ComfyUI 的正规 id。 */
  nodeId: string;
  title: string;
  uid: string; // class_type 的前 8 个字符 —— 用作副标题
  inputs: RawInputMeta[];
  /** 每个输出的显示元数据，来自原始 JSON（例如子图暴露的 IMAGE 输出）。
   *  子图没有输出时为空。 */
  outputs?: RawOutputMeta[];
  widgetValues: unknown[];
  /** 进入子图内部图的回调。 */
  onEnter?: () => void;
  /** 语义与 WorkflowNodeData.connectedOutputs 相同 ——
   *  只有在这个集合里的输出才会拿到可见的 source Handle。 */
  connectedOutputs?: Set<string>;
  /** 在**父级**工作流里有外部连线的输入**名字**（与 `inputs[i].name`
   *  对应）。WorkflowSubgraphNode 只为名字出现在这里的输入渲染 target
   *  Handle。独立的（未连线）子图输入仍保留标签行，让用户看得见暴露了什么，
   *  但不挂 Handle。 */
  connectedInputs?: Set<string>;
  /** ComfyUI 的精确外框尺寸 { w, h }（只算主体，不含标题栏）。
   *  有值时卡片被强制成这个尺寸。undefined → 按内容驱动。 */
  size?: { w: number; h: number };
  /** LiteGraph 的 `mode`（0 = Always / 2 = Never 静音 / 4 = Bypass）。
   *  语义与 WorkflowNodeData.mode 相同 —— 驱动三态配色覆盖层。 */
  mode?: number;
  /** LiteGraph 标记，逐字透传自原始 JSON。目前读 `flags.collapsed`，
   *  让 ComfyUI 里本来就折叠着的导入子图在这里也保持折叠。 */
  flags?: Record<string, unknown>;
  /** 当前视图的宿主（外层封装）节点 id 链 —— 仅当视图是「下钻后的子工作流
   *  内部」时注入；本卡片自身的暴露口勾选时带着它落库，运行期还原
   *  comfy-cli 展开后的 `host:inner` 拼接 id（见 IoRef.hostNodeId）。 */
  hostNodeId?: string;
}
