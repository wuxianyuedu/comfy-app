import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * 「React Flow → story」注入层（ISSUE #1381 的第三批：三层注入之二）。
 *
 * ## 它解决什么
 *
 * 画布那一族组件不是「给几个 props 就能看」的：它们从 React Flow 的**上下文**里
 * 读运行期事实 —— 缩放（`useStore(s => s.transform[2])`）、视口尺寸、宿主节点 id
 * （`useNodeId()`）、端点几何。不在那个上下文里就抛错（`<Handle>` 拿不到 node id
 * 会抛 error#010），而挂一个**假** provider 得到的是**假的端点几何** ——
 * 比没有 story 更糟（§16.2.3.9 那句判断）。
 *
 * 本模块的答案：给一个**真** `<ReactFlowProvider>` + **真** `<ReactFlow>` 实例，
 * 里面挂着真的起手节点/连线。于是缩放、视口、node id 全是生产代码里那一套算出来
 * 的，story 不伪造任何一项。
 *
 * ## 两条口径（与值源 / store 场景同源）
 *
 * 1. **画布内容由 `CanvasScene` 声明，不各写各的**：一组节点 + 一组连线 + 一个
 *    视口状态。story 挑一种，注入层负责摆成真画布。
 * 2. **缩放/平移给「真值」，不给假的**：`viewport` 直接进 `<ReactFlow
 *    viewport={…}>`（受控），所以「缩到 0.3 时细网格淡出」这类判据看的是真转换
 *    矩阵，不是 story 里临时塞的一个数。
 *
 * ## 与项目画布的边界（为什么不是直接摆 `ProjectCanvas`）
 *
 * 这一层摆的是**朴素的** React Flow 容器 + 业务节点。`ProjectCanvas` 自己有
 * 一整套 store/持久化/右键菜单（那是第三层「整屏容器」的活），把它当成
 * 这一层的宿主会把两件事混在一起 —— 见 `screen-frame.tsx`。
 */
import type { ReactNode } from "react";

/** 一个节点在被摆上真画布时所需要的最小形状（与业务侧同一份 `Node` 类型）。 */
export type FlowNodeSpec = Node;

export interface CanvasScene {
  /** 这个场景解决什么、真数据长什么样（故事读者看这一段才知道自己在看什么）。 */
  readonly about: string;
  readonly nodes: ReadonlyArray<FlowNodeSpec>;
  readonly edges: ReadonlyArray<Edge>;
  /**
   * 初始视口（受控）。`zoom` 会真的进转换矩阵 —— 「细网格在 0.3 以下淡出」
   * 这类判据看的就是它。
   *
   * 消费方传 `fit` 时它会**被忽略**（React Flow 自己算一个缩到装得下的视口）。
   */
  readonly viewport: { x: number; y: number; zoom: number };
  /**
   * 这一档的**被测对象就是那个缩放**（细网格在阈值下淡出、端点圆点在放大档的
   * 像素尺度、密集负载下现算的标尺步长）。
   *
   * 于是它**不能**被 `fit` 缩走 —— 缩到装得下会把要看的那个缩放一起改掉，
   * 而 story 上看着仍然「一切正常」（只是看的不是那一档了）。所以传 `nodeTypes`
   * 的消费方要么传 `fit`、要么用带本标记的场景，判据 `tests/storybook-fit-viewport.test.ts`。
   */
  readonly pinZoom?: true;
}

/**
 * 画布铺底的尺寸：够摆一张卡片与它周围的留白，又不至于把侧栏挤走。
 *
 * **它是「框」，不是「内容」**：框高固定，而节点渲染器的尺寸由消费方决定 ——
 * 于是同一档场景（如 `twoNodes`）在两种消费方下内容高度可以差一倍。内容比框高时
 * （见 `StorybookFlowCanvas` 的 `fit`）必须由消费方显式声明「装不下、请缩到装得下」，
 * 否则下沿会把最后一张卡切掉，而构建 / tsc / eslint 全绿、只有画布上少一截。
 */
export const CANVAS_FRAME_CLASS = "h-[560px] w-full";

/**
 * `fit` 档的留白（React Flow `fitViewOptions.padding`，比例值）。
 *
 * 0.1 = 内容四周各留 ~10%。与 `ProjectCanvas` 工具栏那颗「适应视图」用的
 * `padding: 0.2` 不是同一个用途：那颗是**交互后**的复位（要更多呼吸感），
 * 这份是「一开始就装进框里」，留白太大会把节点缩得很小、10px 的端点行更难认。
 */
const FIT_VIEW_PADDING = 0.1;

/**
 * 场景注册表 —— **唯一**一份「名字 → 真画布」的映射。
 *
 * 加一个场景之前先回答：它的节点与连线是不是**真机上会出现的那种**？随手编几
 * 个孤立节点，等于把一个不存在的形态摆在画布上。
 */
export const CANVAS_SCENES = {
  /**
   * 两张业务节点 + 一条连线：端点几何、node 序号、连线路径三件都在场。
   *
   * ## 边引用的是 handle id，不是节点 id
   *
   * 节点 id 用 `"1"` / `"2"` 这样的**纯数字串**（真画布由 `nodeSeqOf()` 发），
   * 而 `sourceHandle` / `targetHandle` 是**另一件事** —— 它们是 React Flow 在
   * handleBounds 里找锚点的键，两套口径由真画布各管一侧：
   *
   *  · **输出端** → `` `out:${name}` ``（常量 `OUTPUT_PORT_HANDLE_PREFIX`）；
   *  · **输入端** → `ioKey`（工作流节点动态表单里那一份端口键）。
   *
   * 写错时 React Flow **静默丢弃整条边** —— 不报错、控制台干净、画布只是少几条线。
   * 这份文件曾经把两侧都写成 `"1:model"` 这种「看着很像」的短序号，于是三个带边的
   * 场景（含 `fanOut` 那句「扇出三条线」）在画布上**一条线都没有**，而
   * tsc / eslint / 构建 / 既有门禁全绿 —— 是逐 story 数 DOM 上的
   * `.react-flow__edge` 才量出来的。判据见 `tests/storybook-injection-layers.test.ts`。
   *
   * 消费方若**不传 `nodeTypes`**（节点走 React Flow 默认外观，身上没有业务端口），
   * 这一档就必须 `edges: []` —— 否则边引用的 handle 谁也不挂。
   */
  twoNodes: {
    about: "两张业务节点 + 一条连线（端点几何与节点序号的真实现场）",
    nodes: [
      {
        id: "1",
        position: { x: 40, y: 60 },
        data: { label: "加载检查点" },
      },
      {
        id: "2",
        position: { x: 480, y: 240 },
        data: { label: "K采样器" },
      },
    ],
    edges: [
      {
        id: "e1-2",
        source: "1",
        target: "2",
        sourceHandle: "out:model",
        targetHandle: "model",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  /**
   * 一个源节点**扇出**三条连线 —— 多端点几何与连线路径分叉的现场。
   *
   * `twoNodes` 只有一条线，看不出「同一节点的多个源端点各自出线」这件事：
   * 一个节点上挂着多个 `out:<name>` 输出端口，而连线从哪个 handle 出、落在目标
   * 哪个 handle 上，是 React Flow 按 **handle id** 算的路径 —— 假画布给不出。
   *
   * 这一档也是上面那处缺陷的证据现场：三条边曾经因为 handle 名写错而**一条都不画**，
   * 而场景名与 `about` 一直在说「扇出三条线」。
   */
  fanOut: {
    about: "一个源节点扇出三条连线到三个目标（多端点几何 + 连线路径分叉）",
    nodes: [
      { id: "1", position: { x: 40, y: 160 }, data: { label: "加载检查点" } },
      { id: "2", position: { x: 480, y: -60 }, data: { label: "K采样器" } },
      { id: "3", position: { x: 480, y: 160 }, data: { label: "VAE 解码" } },
      { id: "4", position: { x: 480, y: 380 }, data: { label: "保存图像" } },
    ],
    edges: [
      {
        id: "e1-2",
        source: "1",
        target: "2",
        sourceHandle: "out:model",
        targetHandle: "model",
      },
      {
        id: "e1-3",
        source: "1",
        target: "3",
        sourceHandle: "out:vae",
        targetHandle: "vae",
      },
      {
        id: "e1-4",
        source: "1",
        target: "4",
        sourceHandle: "out:clip",
        targetHandle: "clip",
      },
    ],
    viewport: { x: 60, y: 150, zoom: 0.72 },
  },
  /**
   * 各 kind 的节点混排 —— 端点上**五档类型色**同时在场的样子。
   *
   * `NodeKind` 有八档（生图 / 生视频 / 剧本 / Agent / 工作流 / 文本 / 图片 /
   * 视频），而单看一张节点只出一种类型色。「多类型并排时能不能分辨」是画布上
   * 才看得出来的一维（配色表漂了在单节点 story 里看不出来）。
   */
  mixedKinds: {
    about: "八种业务节点混排（端点类型色与节点类型章并排的分辨率）",
    nodes: [
      { id: "1", position: { x: 20, y: 20 }, data: { label: "生图" } },
      { id: "2", position: { x: 410, y: 20 }, data: { label: "生视频" } },
      { id: "3", position: { x: 800, y: 20 }, data: { label: "生成剧本" } },
      { id: "4", position: { x: 20, y: 320 }, data: { label: "Agent 模式" } },
      {
        id: "5",
        position: { x: 410, y: 320 },
        data: { label: "自定义工作流" },
      },
      { id: "6", position: { x: 800, y: 320 }, data: { label: "文本" } },
      { id: "7", position: { x: 20, y: 620 }, data: { label: "图片" } },
      { id: "8", position: { x: 410, y: 620 }, data: { label: "视频" } },
    ],
    edges: [
      {
        id: "e1-2",
        source: "1",
        target: "2",
        sourceHandle: "out:images",
        targetHandle: "images",
      },
      {
        id: "e3-4",
        source: "3",
        target: "4",
        sourceHandle: "out:text",
        targetHandle: "text",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 0.6 },
  },
  /**
   * 密集节点 —— 网格与标尺在**有内容**时的负载（`GRID_FINE_FADE_ZOOM` 之上）。
   *
   * `zoomedOut` 摆的是「缩小到网格淡出」那一档，节点少而视口远；这一档反过来：
   * 节点铺满、缩放还在常规范围内，于是标尺步长与网格间距都按**满负载**现算
   *（`CanvasRulers` 的标签步长是按「屏幕间距 ≥ 48px」算的，空画布看不出这件事）。
   */
  dense: {
    about: "36 张节点铺满画布（标尺步长与网格间距在满负载下现算）",
    pinZoom: true,
    nodes: Array.from({ length: 36 }, (_, index) => ({
      id: String(index + 1),
      position: {
        x: (index % 6) * 260 + 20,
        y: Math.floor(index / 6) * 190 + 20,
      },
      data: { label: `节点 ${index + 1}` },
    })),
    /* 这一档摆的是**装饰层**（网格 / 标尺 / 缩放条）在满负载下的样子，
       消费方 `WorkflowCanvasDecorations.stories.tsx` **不传 `nodeTypes`** ——
       节点走 React Flow 的默认外观，身上没有业务端口。所以这里刻意**不放边**：
       边只会引用一个本档不存在的 handle，被 React Flow 静默丢弃，
       留着就是「场景说有连线、画布上没有」的那种假形态。 */
    edges: [],
    viewport: { x: 0, y: 0, zoom: 0.5 },
  },
  /** 放大档：端点圆点、类型章、网格线在主参考线尺度上的那一档。 */
  zoomedIn: {
    about: "放大到 1.4 倍（细网格与端点圆点的像素尺度都变了）",
    pinZoom: true,
    nodes: [
      {
        id: "1",
        position: { x: 60, y: 80 },
        data: { label: "空Latent" },
      },
    ],
    edges: [],
    viewport: { x: -40, y: -60, zoom: 1.4 },
  },
  /**
   * 缩到细网格淡出的阈值之下（`GRID_FINE_FADE_ZOOM = 0.3`）。
   *
   * 这一档是真实事故的现场：曾被写成「整张网格一起关掉」，连带承载底色的
   * `bgColor` 一起消失，缩到极限时整屏是黑的（用户侧「缩小到能显示节点」那一段）。
   */
  zoomedOut: {
    about: "缩到 0.25（细网格已淡出，但底色必须还在）",
    pinZoom: true,
    nodes: [
      {
        id: "1",
        position: { x: 0, y: 0 },
        data: { label: "保存图像" },
      },
    ],
    edges: [],
    viewport: { x: 600, y: 300, zoom: 0.25 },
  },
} satisfies Record<string, CanvasScene>;

/**
 * 把场景节点都标成某个渲染器的类型。
 *
 * `nodeTypes` 认的是节点上的 `type` 字段，而场景里的节点**不带** `type`
 *（见 `StorybookFlowCanvas` 的 `nodeTypes` 说明：不带的走默认外观，免得渲染器
 * 缺席时静默退成白框）—— 所以要用自己的渲染器时，先经这个函数把类型打上去。
 *
 * ```tsx
 * <StorybookFlowCanvas
 *   scene={withNodeType(canvasScene("twoNodes"), "story")}
 *   nodeTypes={{ story: MyNode }}
 * />
 * ```
 */
export function withNodeType(scene: CanvasScene, type: string): CanvasScene {
  return {
    ...scene,
    nodes: scene.nodes.map((node) => ({ ...node, type })),
  };
}

/** 场景名清单（story 的旋钮取自它，不手抄）。 */
export const CANVAS_SCENE_NAMES = Object.keys(CANVAS_SCENES);

/** 场景名的类型（拼错名字在 tsc 就红）。 */
export type CanvasSceneName = keyof typeof CANVAS_SCENES;

/**
 * 取一个场景；名字不认识时**抛错**（静默回退会让「场景名写错了」看不出来 ——
 * 与值源的 `load()` 同一条口径）。
 */
export function canvasScene(name: string): CanvasScene {
  const scene: CanvasScene | undefined = CANVAS_SCENES[name as CanvasSceneName];
  if (scene === undefined) {
    throw new Error(`画布场景里没有叫「${name}」的那种。现有的：${CANVAS_SCENE_NAMES.join(" / ")}`);
  }
  return scene;
}

/** Args 面板里那条「画布场景」旋钮（选项取自注册表）。 */
export function canvasSceneArgType() {
  return {
    description: "摆上真画布的节点 / 连线 / 视口（由注入层按真类型摆）",
    control: { type: "select" as const },
    options: CANVAS_SCENE_NAMES,
  };
}

/**
 * 摆一块**真**画布，children 作为节点内容渲染。
 *
 * `nodes` / `edges` 由场景给，`children` 是 story 自己的节点渲染器
 *（业务节点就是通过它挂进来的 —— 于是 `useNodeId()` 拿到的是真宿主 id）。
 *
 * ## 视口：两种口径，由消费方选（`fit`）
 *
 * 默认是**受控**的（`viewport` + `onViewportChange` 空实现）：初始缩放真的进
 * 转换矩阵，而用户拖拽不改变它 —— story 要的是「在某个缩放下长什么样」这一个
 * 被钉住的现场，不是一块可交互的沙盒（要交互请用 `ProjectCanvas` 那一层的 story）。
 *
 * 而当消费方的节点渲染器**比框高**时（框架 `CANVAS_FRAME_CLASS` 是固定的 560px，
 * 渲染器尺寸却是消费方的事），钉住的视口会把最后一张卡的下沿切掉 —— 那是真机上
 * 不存在的形态，且构建 / tsc / eslint 全绿、只有画布上少一截。此时消费方传 `fit`，
 * 交回 React Flow 自己的 `fitView`（`ProjectCanvas` 也是这套机制）：把整个场景
 * 缩到框里，**不裁内容**。
 *
 * 两种口径**互斥**：`fit` 时 React Flow 忽略 `viewport`（它自己算一个），所以
 * 「钉住某个缩放的语义档」（细网格淡出、放大档的像素尺度）**不能**传 `fit` ——
 * 那些档要看的就是那个缩放，不是「内容装得下」。
 */
export function StorybookFlowCanvas({
  scene,
  nodeTypes,
  fit = false,
  children,
}: {
  children?: ReactNode;
  /**
   * 把整场缩到框里（`fitView`），而不是用场景里钉住的视口。
   *
   * 传它的判据只有一条：**我的节点渲染器装不进 560px 的框**。装得下就照旧钉住
   * 视口 —— 缩放本身是有些档的被测对象。
   */
  fit?: boolean;
  /**
   * 业务节点渲染器。`nodeTypes` 是 React Flow 认节点的唯一入口，而「用哪个
   * 渲染器」是 story 的事（画布节点 / 库预览 / 子图各一）。
   *
   * **不传就摆默认外观**（白框 + `data.label`）—— 场景里那种「只想让你看端点 /
   * 网格 / 标尺」的时候用它。传了的时候场景里的节点会走你给的渲染器，所以
   * `type` 要由调用处自己在节点上声明（场景提供的节点**不带** `type`，免得
   * 渲染器缺席时静默退成白框、看起来像「节点坏了」）。
   */
  nodeTypes?: NodeTypes;
  scene: CanvasScene;
}) {
  return (
    <div className={`${CANVAS_FRAME_CLASS} bg-canvas relative`}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={[...scene.nodes]}
          edges={[...scene.edges]}
          nodeTypes={nodeTypes}
          /* 两种视口口径互斥：`fit` 时 React Flow 自己算视口、`viewport` 不传
             （传了也不会被用，但留着会让人以为「钉住 + 自适应」能同时成立）。 */
          {...(fit
            ? {
                fitView: true,
                fitViewOptions: { padding: FIT_VIEW_PADDING },
              }
            : {
                viewport: scene.viewport,
                onViewportChange: () => undefined,
              })}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          {/* 细网格 + 主参考线：与 `WorkflowCanvasDecorations` 的 `CanvasGrid`
              同一个判据来源（缩放太低时细线淡出、底色留下）。这里用 React Flow
              自带的 `<Background>` 摆一份等价的底，好让「底色在不在」这件事在
              画布上看得见 —— 它是画布有没有渲染出来的唯一直观凭据。 */}
          <Background
            variant={BackgroundVariant.Lines}
            gap={10}
            lineWidth={1}
            color="var(--color-border)"
          />
          <Background
            id="major"
            variant={BackgroundVariant.Lines}
            gap={100}
            lineWidth={1}
            color="var(--color-border-strong)"
          />
          {children}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
