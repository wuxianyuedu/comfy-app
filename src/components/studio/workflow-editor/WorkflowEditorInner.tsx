"use client";
/* 拆出来的 WorkflowEditorInner —— 内层编辑器，必须住在
 * ReactFlowProvider 里面。节点渲染器与注册表已移到 wf-editor-nodes.tsx
 *（分组节点、IO 端口节点、便签节点，以及节点类型表、连线类型表与共享布局常量）。
 * 它原本在 WorkflowCanvasEditor.tsx 里。 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStoreApi,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { refreshCustomNodes } from "~/config/custom-nodes";
import { Button } from "~/components/ui/button";
import { PageLoading } from "~/components/ui/page-loading";
import { SourceModal } from "../SourceModal";
import type { WorkflowDetail, WorkflowIOParam } from "../workflow-types";
import { buildEdges } from "../workflow-utils";
import { useMiniMapJump } from "../useMiniMapJump";
import { CanvasSettingsPanel } from "../canvas/CanvasSettingsPanel";
import { useCanvasSettings } from "../canvas/hooks/use-canvas-settings";
import {
  WFStoresProvider,
  useIOEditApi,
  useRgthreeApi,
  useViewerApi,
  useIOEditStore,
  selectIoEditMode,
  selectWorkflowIO,
  selectIoPreviewOpen,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
} from "./WorkflowStores";

import { WorkflowEditorTopBar } from "./WorkflowEditorTopbar";
import { WorkflowIoPreviewPanel } from "../WorkflowIOPreviewPanel";
import { WorkflowEditorCanvas } from "./WorkflowEditorCanvas";
import { buildInitialNodes } from "./workflow-editor-build-nodes";
import { useWorkflowDetailLoader } from "./hooks/use-workflow-detail-loader";
import { useWorkflowDerivedData } from "./workflow-editor-derived";
import { enrichFromViewNodes } from "./io-exposure";
import { useWorkflowPersistence } from "./hooks/use-workflow-persistence";
import { useWorkflowSaveMutation } from "./hooks/use-workflow-save";
import { FullScreenLayer } from "../fullscreen/FullScreenLayer";
import {
  computeFitViewport,
  createFitOnceScheduler,
  createFitSettleStepper,
  normalizeBounds,
  type Bounds,
  type FitBoundsNode,
} from "./subgraph-viewport";
import { onNextFrame } from "~/lib/next-frame";
import { zClass } from "~/lib/shell/overlay-z";

/* ── 画布网格 ──
 *  两层叠起来用原生 <Background> 实现，让网格随视口平移 / 缩放
 *（早先那版是给 `.react-flow__pane` 加 CSS 网格，结果是静态的 ——
 * 因为 pane 是不做变换的交互层）：
 *
 *    · 细线 —— 每 GRID_CELL 像素一条（即 1 格）
 *    · 粗线 —— 每 10 格一条，略粗且更亮
 *
 *  一格 = 10 个画布单位，因此常见节点宽度（例如 230px 的 MarkdownNote）
 *  正好落在整数格上（23 格），让「每 N 格对齐一次」有意义，而不是一个零头分数。
 *
 *  `BackgroundVariant.Lines` 每个图案 tile 会画一条贯通全高 / 全宽的线段，
 *  所以 tile 拼接起来就是连续的十字网格线 —— 不是本文件早先那条注释所说的
 *  「`+` 星座」形状。
 *
 *  层序要紧：粗线网格最后渲染，因此会盖在细线之上。
 *  只有细线层带 `bgColor`；粗线层必须保持 `transparent`，
 *  否则会把下面那层整个刷白。
 *
 *  缩放低于约 0.65 时，10px 的格子会缩到屏幕 6.5px 以下，细网格就变成噪点，
 *  于是它的透明度淡出，而 10 格一条的粗线留在原地，让画布仍可读。
 *  选择器返回的是**已经量化过的**透明度，因此平移 / 缩放只在淡出真的跨档时才重渲染。
 *
 *  按用户要求：视口缩到 60% 及以下时整个网格（细线 + 粗线）隐藏。
 *  在这个尺度下画布读起来是一张全流程地图，网格只是添乱，
 *  于是直接短路、什么都不渲染。注意 <ReactFlow> 的 minZoom 是 0.15
 *（见 ZoomIndicator），所以我们不会遇到「还想要网格、却因技术原因拿不到」的缩放档。 */
/* ── 画布聚焦（打开工作流 / 子工作流时把视口对准真实内容）──
 *
 *  算式本体在 subgraph-viewport.ts（纯函数 + 单测）；这里只放与 React Flow
 *  store 打交道的部分：挑出参与包围盒的节点、读容器尺寸、下发视口。
 *
 *  为什么必须「反复算、直到收敛」而不是一次性 fitView：节点是分批测量的
 *  （视口裁剪下只有看得见的节点会挂载并被量到尺寸）。第一帧里测量的范围
 *  恰好就是上一个视图留下的那块视口，据此 fit 会把整张图当成「就那么大」，
 *  子图内容于是停在视野外（ISSUE #394）。 */
const FIT_FALLBACK_SIZE = { width: 240, height: 80 } as const;
/** 连续多少轮测量结果不再扩大就收手（超大图逐屏挂载时不必等全部量完）。 */
const FIT_SETTLE_ROUNDS = 3;
/** 轮数护栏，避免测量始终不稳时无限重算。 */
const FIT_MAX_ATTEMPTS = 24;

/** 参与聚焦的节点：真实节点（`wfNode` / `wfSubgraph` / `wfNote`）。
 *  跳过左右栏的边界口与它们的 `grp:bpin:*` 外框 —— 那两条栏位于
 *  `minX - RAIL_GAP` / `maxX + RAIL_GAP`（见 workflow-editor-build-nodes），
 *  参与包围盒就会把中心拉偏、把工作流压成一条细缝。 */
function collectFitTargets(
  nodes: readonly {
    id: string;
    type?: string;
    position: { x: number; y: number };
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
    style?: { width?: number | string; height?: number | string };
  }[],
): FitBoundsNode[] {
  const out: FitBoundsNode[] = [];
  for (const n of nodes) {
    if (n.type === "wfIoPort") continue;
    if (String(n.id).startsWith("grp:bpin:")) continue;
    out.push(n);
  }
  return out;
}

/** 下发一次视口。没有可测量的节点时退回 React Flow 自己的 fitView。
 *
 *  `container` 必须传入**本画布实例自己**的尺寸（取自 React Flow store 的
 *  `width` / `height`）。此前这里写的是 `document.querySelector(".react-flow")`
 *  —— 页面上只要有第二个 React Flow（工作流库详情面板的画布预览就在同一个
 *  DOM 里），querySelector 命中的是**文档顺序里第一个**，于是本画布用一个
 *  别的容器的宽高去算居中，打开时视口落在内容之外（ISSUE #717）。
 *  `width`/`height` 由 React Flow 自己按本实例容器测量，天然是实例私有的。 */
function applyFitViewport(
  container: { width: number; height: number },
  rf: {
    fitView: (options?: { padding?: number; duration?: number }) => unknown;
    setViewport: (
      viewport: { x: number; y: number; zoom: number },
      options?: { duration?: number },
    ) => unknown;
  },
  bounds: Bounds | null,
  zoomBounds: { minZoom: number; maxZoom: number },
): void {
  const viewport = computeFitViewport(bounds, container, zoomBounds);
  if (!viewport) {
    void rf.fitView({ padding: 0.1, duration: 0 });
    return;
  }
  void rf.setViewport(viewport, { duration: 0 });
}

/* 外层：创建 3 个 per-instance Zustand store（经 createIOEditStore 等工厂），
 * 再经 <WFStoresProvider> 下发。状态判断逻辑与渲染子树都在这之下。 */
export function WorkflowEditorInner({
  workflowId,
  onClose,
  onSave,
}: {
  workflowId: string;
  onClose: () => void;
  onSave?: () => void;
}) {
  /* 3 个按实例创建的 Zustand store，每次挂载只建一次。
   * 用 useState 的惰性初始化让它们保持稳定，又不必在渲染期去碰 ref
   *（否则触发 react-hooks/refs 规则）。 */
  const [stores] = React.useState<WFStoresHelper>(() => ({
    io: createIOEditStore(workflowId),
    rgthree: createRgthreeGroupsStore({ workflowId, detail: null }),
    viewer: createNodeJsonViewerStore({
      detail: null,
      rawMetaById: {},
      positions: null,
      subgraphRawContext: null,
      subgraphStackLength: 0,
    }),
  }));
  return (
    <WFStoresProvider stores={stores}>
      <WorkflowEditorBody
        workflowId={workflowId}
        onClose={onClose}
        onSave={onSave}
      />
    </WFStoresProvider>
  );
}

interface WFStoresHelper {
  io: ReturnType<typeof createIOEditStore>;
  rgthree: ReturnType<typeof createRgthreeGroupsStore>;
  viewer: ReturnType<typeof createNodeJsonViewerStore>;
}

/* 内层：全部既有逻辑。经 useIOEditApi/useRgthreeApi/useViewerApi 直读直写
 * store（hook 在 <WFStoresProvider> 之下才合法，故体逻辑用 *Api 访问）。 */
function WorkflowEditorBody({
  workflowId,
  onClose,
  onSave,
}: {
  workflowId: string;
  onClose: () => void;
  onSave?: () => void;
}) {
  const ioApi = useIOEditApi();
  const rgthreeApi = useRgthreeApi();
  const viewerApi = useViewerApi();
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paramMap, setParamMap] = useState<Record<string, unknown>>({});
  /* workflowIO / ioEditMode / ioPreviewOpen 已收进 Zustand IOEditStore。
   * 这里用 selector 订阅成响应式局部变量，让下方既有合并/预览/保存逻辑零改动。 */
  const workflowIO = useIOEditStore(selectWorkflowIO);
  const ioEditMode = useIOEditStore(selectIoEditMode);
  const ioPreviewOpen = useIOEditStore(selectIoPreviewOpen);
  const savePatch = useWorkflowSaveMutation();
  /* IO 预览的侧栏开关。默认关闭 —— 画布本身信息量已经很大，
   *  用户没主动要之前，不宜再叠一个浮动面板上去。
   *
   *  与 `ioEditMode` 是双向耦合：开预览一并进编辑模式（勾选框要可用），
   *  关预览一并退出编辑模式（面板没了就不该再留一排勾选框）；反方向同样
   *  成立 —— 关编辑模式一并关预览。两层耦合都写在 store 的
   *  `setIoEditMode` / `setIoPreviewOpen` 里，见那里的注释。 */
  /* 画布设置面板的开关 —— 与 ioPreviewOpen / viewJsonOpen 并列，
   *  由画布外框上的齿轮按钮打开。默认关闭。 */
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  /* 设置 hook 持有唯一一份「localStorage 持久化」的设置对象，
   *  驱动画布网格、标尺、缩放指示器与小地图。
   *  在 `hydrated` 为真之前一律用默认值渲染，避免 SSR / 首屏在读取完成前
   *  短暂闪出已保存的值。 */
  const {
    settings: canvasSettings,
    update: updateCanvasSetting,
    reset: resetCanvasSettings,
    hydrated: canvasSettingsHydrated,
  } = useCanvasSettings();
  /* 画布顶部「📋 查看 JSON」按钮 — 复用 SourceModal。
   *  数据直接从 `detail.graph/rawJson` 读 (缓存里的磁盘已保存版本)，
   *  无需网络请求；当前未保存的画布修改不在内，文案里写明。 */
  const [viewJsonOpen, setViewJsonOpen] = useState(false);
  const setWorkflowIO = useCallback(
    (
      updater:
        | Record<string, WorkflowIOParam>
        | ((
            prev: Record<string, WorkflowIOParam>,
          ) => Record<string, WorkflowIOParam>),
    ) => {
      ioApi.setState((state) => ({
        workflowIO:
          typeof updater === "function" ? updater(state.workflowIO) : updater,
      }));
    },
    [ioApi],
  );
  /* 预览开关一律走 store 动作：关闭预览时 store 会把 `ioEditMode` 一并关掉、
   *  打开时一并打开，绕过动作直接写状态就会留下「面板没了、勾选框还在」或
   *  「面板出来了、勾选框不可用」的两截状态（见 store 里那两个动作的注释）。 */
  const setIoPreviewOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi
        .getState()
        .setIoPreviewOpen(
          typeof v === "function" ? v(ioApi.getState().ioPreviewOpen) : v,
        ),
    [ioApi],
  );
  const [error, setError] = useState("");
  /* 挂载时把磁盘上的自定义节点 manifest 同步进内存注册表一次，
   *  让 <PackageFooter> 能解析每个节点的「类型 → 所属包」映射，
   *  而不必让每个节点各自发一次 /api 请求。
   *  manifest 在首次解析后已经在服务端缓存，因此每次打开页面只花一次廉价往返。 */
  useEffect(() => {
    refreshCustomNodes().catch((e) => console.warn("[we] 节点清单刷新失败", e));
  }, []);
  /* 子工作流导航栈。查看顶层工作流时为空。
   *  每一项是 {uid, name}，供面包屑显示；点某一级会退回到那一层。 */
  const [subgraphStack, setSubgraphStack] = useState<
    { uid: string; name: string; nodeId: string }[]
  >([]);
  /* 根工作流的显示名在**第一次**顶层拉取时记下，之后跨越子工作流导航一直保留，
   *  于是面包屑总能渲染成「<根工作流> / <子工作流 1> / <子工作流 2> …」。
   *  没有它的话，钻进子图会把最前面那一级改写成子图自己的名字
   *（因为 `detail.name` 变成了子图的标题），
   *  既会出现令人困惑的「subA / subA」重名，
   *  又会触发「点子图名字 → 又进一层」的递归 bug。 */
  const [rootWorkflowName, setRootWorkflowName] = useState<string>("");
  const [subgraphLoading, setSubgraphLoading] = useState(false);
  const [subgraphError, setSubgraphError] = useState("");

  /* 子工作流「查看 JSON」要支持 RAW。
   *
   * 后端 `/api/workflows/:id/subgraph?uid=...` 返回的 sub-detail 只携带
   * sub 自己的 API graph (`graph`)，**不带 rawJson** —— 因为 sub 的
   * LiteGraph json 物理上存放在父 `rawJson.definitions.subgraphs[uid]`
   * 里，没有独立的"sub rawJson"概念。
   *
   * 所以我们在 drill-in 进 sub 的那一瞬把**父 rawJson + 当前 sub uid**
   * 缓存进 `subgraphRawContext`；SourceModal 在 sub 视图下用这个 state
   * 拼出 `parentRawJson.definitions.subgraphs[subUid]` 喂给 JsonViewer。
   * 顶层 detail 视图下此 state 为 null，SourceModal 直接读 `detail.rawJson`。
   *
   * 为什么不把 sub rawJson 直接灌到 `detail.rawJson`?
   *  - detail 是 WorkflowDetail 形状，rawJson 字段语义是"该工作流本身的
   *    原始格式"，sub 视图下注入父 rawJson 会污染 detail 语义；
   *  - 保留 `subgraphRawContext` 这个独立槽位，fetchDetail 内部清/设，
   *    配合 `detailRef` 抓"drill-in 那一瞬的父 detail"，时序最稳。
   */
  const [subgraphRawContext, setSubgraphRawContext] = useState<{
    parentRawJson: unknown;
    subUid: string;
  } | null>(null);
  /* 同步 detail 进 ref —— fetchDetail 是 useCallback, 内部读
   * `detail?.rawJson` 时, 因为 closure, 拿到的可能是 stale detail
   * (drill-in 之后 setDetail 已经把 detail 换成 sub 的)。detailRef
   * 总是反映**当前**的 detail, 配合 fetchDetail 顶部读取, 能稳定
   * 拿到"drill-in 那一瞬还是父 detail"的 rawJson。 */
  const detailRef = useRef<WorkflowDetail | null>(null);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  /* 「查看源文件」要展示**磁盘上的原始 JSON**，而不是派生的可执行视图
   *  —— 用户点这个按钮是想核对 ComfyUI 保存的源文件（nodes[] / links[] /
   *  widgets_values）。所以这里取 `detail.rawJson`。sub 视图同理。 */
  const sourceModalData = useMemo<{
    name: string;
    source: unknown;
    isSubgraph: boolean;
  } | null>(() => {
    if (!detail) return null;
    const isSubgraphView = subgraphStack.length > 0;
    const raw: unknown = (() => {
      if (!isSubgraphView) return detail.rawJson ?? null;
      /* sub 视图：源文件 = 父 rawJson 的 definitions.subgraphs[subUid]（见上方
       * subgraphRawContext 的注释）。 */
      const ctx = subgraphRawContext;
      if (!ctx) return null;
      const subs = (
        ctx.parentRawJson as {
          definitions?: { subgraphs?: Record<string, unknown> };
        } | null
      )?.definitions?.subgraphs;
      if (!subs) return null;
      return (
        subs[ctx.subUid] ??
        Object.values(subs).find(
          (s) => (s as { id?: unknown } | null)?.id === ctx.subUid,
        ) ??
        null
      );
    })();
    return {
      name: detail.name ?? "工作流",
      source: raw,
      isSubgraph: isSubgraphView,
    };
  }, [detail, subgraphStack.length, subgraphRawContext]);

  /* fitView 完成后，把视口锁定到「中间那批真实节点」上
   *（WorkflowNode / WorkflowSubgraph / wfNote / wfGroup）。做法是：
   * (a) 调 rf.fitView 时**不**传 `nodes` 过滤 —— 该选项在 React Flow v12 的
   *     各小版本间表现不稳，会让视口随机把边缘的散落引脚也算进去；
   * (b) 随后自己算中间节点的包围盒并调 setViewport，
   *     保证中心一定落在真实工作流上，不受「三段式导轨布局」对画布边界的影响。
   * 同时把缩放夹在**画布自己的缩放区间**（画布设置里的 minZoom / maxZoom）：
   * 上级此前额外钉了一层「聚焦下限 0.35」，本意是别让超宽工作流缩成噪点，
   * 但它与「打开就能看见整份工作流」直接冲突 —— 6700px 宽的图在 0.35 倍下仍有
   * 大半个在视口外，用户打开后还得自己滚轮缩小（ISSUE #717）。现在聚焦只受画布
   * 缩放区间约束，下限交给用户在画布设置里自己定；想放大依旧可以滚轮，
   * 想「一键回到内容处」有右上角的「居中」。
   * 子工作流导航时也会重跑，让局促的子图同样能放下。 */
  const rf = useReactFlow();
  /* 本实例的容器尺寸从 React Flow **本实例的 store** 取，不用
   *  document.querySelector（页面上还有工作流库的画布预览，querySelector 会命中
   *  文档顺序里的第一个 —— 见 applyFitViewport 的注释）。 */
  const rfStore = useStoreApi();
  /* 自动聚焦的记账（详见 subgraph-viewport.ts 的 FitOnceScheduler）：按图的
   * key（detail.id）记「已下发过聚焦的那份图」，切换子图自然会重新聚焦。
   * 关键点是**排程与已聚焦分开**：effect 的依赖会抖（节点整批换掉 →
   * nodes.length 变化），重跑时的 cleanup 会取消还没触发的 rAF；把「已聚焦」
   * 在排程时就记死，会让被取消的那一次永远补不回来 —— 视口于是停在上一份图
   * （ISSUE #394：打开子工作流没聚焦到）。 */
  const fitSchedulerRef = useRef<ReturnType<
    typeof createFitOnceScheduler
  > | null>(null);
  fitSchedulerRef.current ??= createFitOnceScheduler();
  /* 小地图 → 主视口的单击跳转。
   *  与下面 <MiniMap pannable zoomable onClick={onMiniMapJump} /> 配对使用。 */
  const onMiniMapJump = useMiniMapJump(rf);

  /* 单调递增的令牌，防止后台拉取覆盖当前 fetchDetail 的提交。
   *  在 fetchDetail 内部自增；响应到达时持有最大编号的那次调用才有权写 state。
   *  这保证缓存键的升级不会落在「后台拉取悄悄更新了存储、界面却还是旧的」之后。 */
  const latestRequestIdRef = useRef(0);

  /* 把视口对准「当前视图里真实有内容的节点」。
   *
   *  两个调用方：进入工作流 / 子工作流后的自动聚焦（见下方 effect），
   *  以及画布右上角「🎯 居中」按钮 —— 作者把节点拖出视野或缩得太小之后
   *  需要一条回到内容处的出口。纯视口动作：不移动节点、不写库。 */
  const fitToContent = useCallback(() => {
    const { width, height } = rfStore.getState();
    applyFitViewport(
      { width, height },
      rf,
      normalizeBounds(collectFitTargets(rf.getNodes()), FIT_FALLBACK_SIZE),
      { minZoom: canvasSettings.minZoom, maxZoom: canvasSettings.maxZoom },
    );
  }, [rf, rfStore, canvasSettings.minZoom, canvasSettings.maxZoom]);

  /* 「重新居中」按钮。延后一帧再算：React Flow 在下一帧才提交最新的测量
   *  结果，直接算会用到上一帧的尺寸（对刚展开/折叠过节点的画布尤其明显）。
   *  调度本身收在 `~/lib/next-frame`（规范 16 §16.2.4.42）。 */
  const recenterCanvas = useCallback(() => {
    onNextFrame(() => fitToContent());
  }, [fitToContent]);

  /* 拉取工作流详情（进入子工作流时则拉子图详情）。
   * 性能：按 URL 作键的会话级缓存（sessionStorage）让再次打开的画布
   * 立刻出画面，不必等网络。首次打开仍能享受服务端的 LRU 缓存
   *（见 src/lib/server-cache.ts）。命中缓存时立即渲染，
   * 随后在后台刷新存下来的副本，且不打扰界面。 */
  const { fetchDetail, forceReloadDetail, onEnterSubgraph, onExitSubgraph } =
    useWorkflowDetailLoader({
      workflowId,
      detail,
      detailRef,
      latestRequestIdRef,
      setDetail,
      setLoading,
      setError,
      setParamMap,
      setWorkflowIO,
      setSubgraphStack,
      setRootWorkflowName,
      setSubgraphLoading,
      setSubgraphRawContext,
      setSubgraphError,
    });
  /* 把图转成流程节点。渲染顺序（从后到前）：
   *  分组框 → 便签注释 → 真实图节点（恒在最上层）。
   * 真实节点的布局策略按优先级：
   *   1. **已保存的坐标**（RAW 导入）：原样使用 ComfyUI 里的坐标，
   *      让画布与用户当初摆的样子完全一致。
   *   2. **自动布局（按 BFS 分层）**：只给了 API JSON 时用。 */
  /* 提升到组件作用域的 raw meta 与槽位名表 —— 下面的连线 useEffect 也要用，
   * 所以放在组件作用域，而不是塞进 initialNodes 的 memo 里。 */
  /* 单一格式，移除 RAW/API viewMode 与 apiLayoutOverrides 状态 */

  /* 派生查表：raw 节点元数据映射、按视图范围取的详情（RAW / API），
   * 以及每个节点的输出槽位名。 */
  const { rawMetaById, scopeDetail, outSlotNameById } =
    useWorkflowDerivedData(detail);

  /* IO 预览的富化数据源。顶层视图直接用服务端产出的 `detail.workflowIO`；
   * 下钻到子工作流后该字段为空（子图路由不产出它），于是退回「按当前视图
   * 节点元数据就地派生」——否则修复前落库的槽位名/别名会一直显示
   * （ISSUE #349）。派生只补齐缺失键，不覆盖服务端已给的富化结果。 */
  const ioDetailMap = useMemo(() => {
    if (detail?.workflowIO && Object.keys(detail.workflowIO).length > 0) {
      return detail.workflowIO;
    }
    return enrichFromViewNodes(scopeDetail?.nodes);
  }, [detail, scopeDetail]);

  /* P2: 把 detail 派生的查找上下文同步进 viewer / rgthree store，让
   * getNodeJson/getNodeView/getBypass 读到实时 detail（等价于旧 Context
   * 每次用新 props 渲染）。 */
  useEffect(() => {
    viewerApi.setState({
      detail,
      rawMetaById,
      positions: detail?.positions ?? null,
      subgraphRawContext,
      subgraphStackLength: subgraphStack.length,
    });
    rgthreeApi.setState({
      workflowId,
      detail,
      overrides: rgthreeApi.getState().overrides,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, rawMetaById, subgraphRawContext, subgraphStack.length]);

  /* 当前视图的宿主（外层封装）节点 id 链 —— 顶层为空串，下钻后是 `4`（或嵌套
   *  时的 `4:5`）。本层节点都是子图内部节点（id 形如 `1670`），带上它才能在勾选
   *  时落库「外层 + 内层」两个 id，运行期确定性还原成 `4:1670`（ISSUE #349 后续：
   *  不再靠「拿裸 id 扫一遍所有子图定义」兜底）。 */
  const viewHostNodeId = subgraphStack.at(-1)?.nodeId ?? "";

  const graphNodes: Node[] = useMemo(
    () =>
      buildInitialNodes({
        detail,
        scopeDetail,
        rawMetaById,
        outSlotNameById,
        paramMap,
        onEnterSubgraph,
        hostNodeId: viewHostNodeId || undefined,
      }),

    [
      detail,
      scopeDetail,
      rawMetaById,
      outSlotNameById,
      paramMap,
      onEnterSubgraph,
      viewHostNodeId,
    ],
  );

  /* ── 对外参数映射：编辑器不碰 ──
   *
   * 勾选 IO 只做一件事：把 pin 暴露成「对外参数」（写 workflowIO 落库）。
   * 「对外参数 → 节点端口」的落点映射**完全不在本编辑器里编辑**：画布上没有卡片，
   * 连线与落点都在工作流库详情的「画布节点」页签（卡片列 + 连线层，见
   * workflow-library/WorkflowParamCardColumn 与 WorkflowParamWires）。
   *
   * 编辑器也不再提供「恢复默认映射」：那条线归库内那一层管，编辑器只管把当前
   * `paramMap` **原样**保存回去（保存路径见 useWorkflowPersistence）—— 库内改过的
   * 落点不会因为在这里按一次保存就被抹掉。 */

  /* useNodesState 只接受挂载首帧的初值；后续同步统一走下面的 effect（初始图节点
   * 即为这一帧的初值，detail 就绪后才会补上）。 */
  const [nodes, setNodes, onNodesChange] = useNodesState(graphNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /* 画布上只有**工作流图**本身：图节点与图连线都来自工作流自身
   * （`buildInitialNodes` / `buildEdges`）。对外参数卡片与其映射线已从编辑器移除
   * —— 它们会浮在图节点之上挡掉一片，且落点编辑已收敛到工作流库的「画布节点」
   * 页签（用户口径：「彻底不显示」）。 */
  const initialNodes: Node[] = graphNodes;

  /* 图或映射变化时同步节点与连线。useNodesState 只在挂载时取初始值，
   * 所以工作流详情异步到达（或作者改了某条线）时，
   * 必须由我们自己把刚派生出的节点推进流程状态。 */
  useEffect(() => {
    setNodes(initialNodes);
    /* 连线只有一种来源：工作流图自身的 `buildEdges`。 */
    setEdges(buildEdges(scopeDetail, graphNodes, outSlotNameById));
  }, [
    initialNodes,
    graphNodes,
    scopeDetail,
    outSlotNameById,
    setNodes,
    setEdges,
  ]);

  /* 每打开一次工作流 / 子工作流就贴合内容一次。放在 `nodes` 之后，
   * 避免在声明之前引用它（否则触发 react-hooks/immutability 规则）。 */
  useEffect(() => {
    if (nodes.length === 0) return;
    /* nodes 是异步填充的：依赖里若没有 nodes.length，effect 会在数组还空着时
     * 提前 return，且此后不再触发，画布将永远停在默认缩放。这里按「图的 key」
     * 记录已经 fit 过的那份图——首次拿到节点、或切到另一份图/子图时才 fit，
     * 用户后续增删节点不会反复抢走其视角。
     *
     * 「已 fit」记的是**下发过视口**的图，不是「排过程」的图：下面的节点同步
     * effect 会让 nodes.length 变化、进而重跑本 effect，重跑前的 cleanup 取消
     * 掉还没触发的那一帧 rAF。排程即记账会把这次聚焦吃掉（视口留在上一份图，
     * 表现就是「打开子工作流没聚焦到」，ISSUE #394）。 */
    const fitKey = detail?.id ?? "__root__";
    const scheduler = fitSchedulerRef.current;
    if (!scheduler?.markPending(fitKey)) return;
    /* 节点是**分批**测量的：React Flow 先挂载再量 DOM，首帧里只有视口内
     *  （恰好是被上一个视图带偏的那一块）的节点拿得到 measured，其余仍是 0。
     *  只在「第一帧 / 第二帧」fit 会把这次测量结果当成整张图的范围 ——
     *  子图内容在视野外就这么来的（ISSUE #394）。
     *
     *  所以每次测量到位都重算一次，收敛到「本次 fit 覆盖的范围不再扩大」为止：
     *  要么整个 bbox 都被量到（内容完整、范围稳定），要么连续若干次不再增长
     *  （超大图逐屏挂载，此时以已量到的内容为准）。上限只是护栏。 */
    const stepper = createFitSettleStepper({
      fallbackSize: FIT_FALLBACK_SIZE,
      settleRounds: FIT_SETTLE_ROUNDS,
      maxAttempts: FIT_MAX_ATTEMPTS,
    });
    let raf = 0;
    const step = () => {
      const { bounds, done } = stepper.next(() =>
        collectFitTargets(rf.getNodes()),
      );
      const { width, height } = rfStore.getState();
      applyFitViewport({ width, height }, rf, bounds, {
        minZoom: canvasSettings.minZoom,
        maxZoom: canvasSettings.maxZoom,
      });
      /* 收敛（测量已稳定、视口已下发）后才把这份图记为「聚焦过」：只排过程
       * 不算数，否则被 cleanup 取消的那次就补不回来了。提前在首帧记账也不
       * 行 —— 首帧可能还在量上一份图的节点，会把这帧的范围错当成本图的。
       * 记账后本 effect 的重跑（增删节点 / 拖动引起的依赖抖动）不再抢视角。 */
      if (!done) {
        raf = requestAnimationFrame(step);
        return;
      }
      scheduler.markSettled(fitKey);
    };
    /* 延后一帧，等 ReactFlow 量好视口、摆好节点再贴合。 */
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rf, rfStore, canvasSettings, detail?.id, nodes.length]);

  /* 惰性连线交互。画布的 defaultEdgeOptions 把 deletable / reconnectable
   *  都设成 false，未被动过的连线因此保持惰性；某条线第一次被点击时两个标志一起打开
   *（之后再点幂等），于是用户仍能像以前一样删除 / 重连它，
   * 而整张图不会为没人碰的连线白白付交互开销。 */
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (edge.deletable === true && edge.reconnectable === true) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edge.id ? { ...e, deletable: true, reconnectable: true } : e,
        ),
      );
    },
    [setEdges],
  );

  /* 对外参数卡片的「已连线目标」高亮：卡片行上没有端点，靠宿主节点那一行
   * 的自带端口体现；这里只需保证被映射到的端口所在行能拿到 targetHandle
   * （WidgetInputRow 的 withHandle 已按 ioKey 挂 handle，无需额外标记）。 */

  const { resetLayout, handleSave, onNodeDragStop } = useWorkflowPersistence({
    workflowId,
    detail,
    setDetail,
    setNodes,
    paramMap,
    workflowIO,
    fitToContent,
    savePatch,
    onSave,
    onClose,
    setSaving,
    setError,
    /* 重置布局之后重新拉当前视图：服务端已经把坐标覆盖删掉，重拉拿到的就是
     *  工作流自带的原始布局。 */
    reloadView: () => forceReloadDetail(viewHostNodeId, true),
    /* 子图视图下把宿主链路传进去：内部节点 id 要拼成 `宿主:内部` 才与
     *  `positions` 列里的键同口径（见 use-workflow-persistence 的说明）。 */
    hostNodeId: viewHostNodeId,
  });
  /* Loading state */
  if (loading) {
    return (
      <FullScreenLayer
        zClass={zClass("modal")}
        className="bg-canvas flex items-center justify-center pb-6"
      >
        <PageLoading label="加载工作流节点…" />
      </FullScreenLayer>
    );
  }

  if (error || !detail) {
    return (
      <FullScreenLayer
        zClass={zClass("modal")}
        className="bg-canvas flex items-center justify-center pb-6"
      >
        <div className="text-center">
          <p className="text-destructive">{error ?? "未知错误"}</p>
          <Button
            variant="outline"
            onClick={onClose}
            className="hover:bg-surface-2 mt-3 h-auto px-4 py-2 text-sm"
          >
            返回
          </Button>
        </div>
      </FullScreenLayer>
    );
  }

  return (
    <FullScreenLayer
      zClass={zClass("modal")}
      className="bg-canvas flex flex-col pb-6"
    >
      {/* ── Top bar ── */}
      <WorkflowEditorTopBar
        onClose={onClose}
        detail={detail}
        rootWorkflowName={rootWorkflowName}
        subgraphStack={subgraphStack}
        setSubgraphStack={setSubgraphStack}
        fetchDetail={fetchDetail}
        onExitSubgraph={onExitSubgraph}
        forceReloadDetail={forceReloadDetail}
        viewHostNodeId={viewHostNodeId}
        setViewJsonOpen={setViewJsonOpen}
        resetLayout={resetLayout}
        handleSave={handleSave}
        saving={saving}
        error={error}
      />

      {/* ── Canvas ── */}
      <div className="relative min-h-0 flex-1">
        {/* 子图下钻 / 上浮遮罩：父图保持完整可见，
         *  只在上面画一张轻量的居中 spinner 卡片。
         *  这就是要求的 UX：当前内容不变，然后
         *  一屏加载，再切到子图内容。 */}
        {subgraphLoading && (
          <div className="bg-canvas-deep z-base pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="bg-canvas/90 border-border-strong pointer-events-auto rounded-xl border px-6 py-4 shadow-2xl shadow-black/10 backdrop-blur-sm dark:shadow-black/50">
              <PageLoading
                label="加载子工作流…"
                className="flex-row items-center gap-3"
              />
            </div>
          </div>
        )}
        {ioEditMode && (
          <div className="border-warning/40 bg-warning/15 text-warning-strong z-canvas-ui pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border px-4 py-1.5 text-[12px] font-medium shadow-lg backdrop-blur-sm">
            📌 IO
            编辑模式：勾选节点参数前的复选框，即可将其暴露为工作流的「输入」或「输出」
          </div>
        )}
        {/* 子工作流下钻失败：内联错误提示，父图保持可见（绝不回退到工作流库） */}
        {subgraphError && (
          <div className="z-canvas-max pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
            <div className="border-destructive/40 bg-destructive/15 text-danger-strong pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2 text-[12px] shadow-lg backdrop-blur-sm">
              <span>⚠ {subgraphError}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSubgraphError("")}
                className="hover:bg-subtle text-danger-strong h-auto w-auto rounded px-1.5 py-0.5"
                aria-label="关闭"
              >
                ×
              </Button>
            </div>
          </div>
        )}
        {/* IO 预览侧栏。渲染 CreatePanel / 画布工作流节点
         *  消费的同一个 DynamicWorkflowForm，数据来自**实时的**
         *  `workflowIO` 状态（不是服务端缓存的富化结果）。这让作者在
         *  画布上勾一个复选框，就能立刻在预览里看到新行出现，
         *  还能重命名任何行的显示标签并看到它
         *  回写到已落盘的选择里。紧凑模式以
         *  匹配用户在运行时会看到的画布内渲染。
         *
         *  位置：右上角，约 360px 宽，max-h 会避开
         *  底部工具栏。`z-canvas-max`，压在 MiniMap + Controls
         *  之上、保存 toast 之下。面板自身的指针事件
         *  是开着的；包裹层只在面板外侧的留白上等效于
         *  pointer-events:none（我们用一个 flex
         *  容器，所以整块都是可交互的）。
         *
         *  数据合并。本地 `workflowIO` 状态只
         *  带 toggleIO 写的那四个身份字段 —— 它
         *  **没有** type/defaultValue/nodeTitle/multiline，那些
         *  来自 `api/workflows/[id].route.ts` 的服务端富化。
         *  不合并时，每个新切换的针脚都会渲染成只读的 `link` 占位
         *  （controlForEntry 对没有标量值的 type "*" 会落到 "link"）。
         *  解法：对本地状态里的每个 key，优先取
         *  `detail.workflowIO[key]`（已富化），再把本地 `label`
         *  叠上去，这样未保存的重命名立即生效。 */}
        {ioPreviewOpen && (
          <WorkflowIoPreviewPanel
            workflowIO={workflowIO}
            detailIOMap={ioDetailMap}
            modes={detail.availableModes ?? []}
            defaultMode={detail.defaultMode ?? null}
            onModesChange={(modes, defaultMode) => {
              /* 模式集合变更立即落库（与库详情「类型」同一存储），并同步
               * 本地 detail 让页签即时反映。被移除的模式在各 IO 条目上的
               * 覆盖层（modes[mode]）必须一并摘掉——页签栏只跟 modes 走，
               * 留下的无主覆盖会一直随 workflowIO 落库往返；清理结果随同
               * 一 PATCH 落库。 */
              const removedModes = (detail.availableModes ?? []).filter(
                (m) => !modes.includes(m),
              );
              const cleanedIO =
                removedModes.length > 0
                  ? ioApi.getState().purgeModeOverrides(removedModes)
                  : null;
              setDetail((prev) =>
                prev
                  ? {
                      ...prev,
                      availableModes: modes,
                      defaultMode,
                      taskType: defaultMode,
                    }
                  : prev,
              );
              savePatch.mutate({
                id: workflowId,
                modes,
                defaultMode,
                taskType: defaultMode,
                ...(cleanedIO ? { workflowIO: cleanedIO } : {}),
              });
            }}
            onClose={() => setIoPreviewOpen(false)}
          />
        )}
        <WorkflowEditorCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          canvasSettings={canvasSettings}
          canvasSettingsHydrated={canvasSettingsHydrated}
          onMiniMapJump={onMiniMapJump}
          onOpenSettings={() => setCanvasSettingsOpen(true)}
          onRecenter={recenterCanvas}
          onEdgeClick={onEdgeClick}
          /* 选中节点后由画布把「相关连线」与「相关端口行」标记分别写回 edges /
           * 节点 data（连线加粗提亮，落到的端口行同步提亮）。 */
          setEdges={setEdges}
          setNodes={setNodes}
        />
        {/* Floating instruction tooltip —— 这条气泡是「固定暗色清单」条目 1
           （叠在画布内容上的极小面积叠层），底色恒为 bg-black/60。
           因此**文字也必须用固定浅色**：此前用随主题的 text-ink-soft，
           浅色主题下它是深灰 (#52525b)，压在深色气泡上等于深底深字，
           看不出这条提示（ISSUE #609 红框圈的那块）。 */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-[11px] text-gray-300 backdrop-blur-sm">
          点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
        </div>
        {/* 右边缘画布设置抽屉。面板自己把内容 portal 到
         *  document.body，好让它压在
         *  WorkflowCanvasEditor 根遮罩栈（`modal` 档）之上；只在
         *  点击齿轮按钮时渲染。 */}
        {canvasSettingsOpen && (
          <CanvasSettingsPanel
            settings={canvasSettings}
            update={updateCanvasSetting}
            reset={resetCanvasSettings}
            onClose={() => setCanvasSettingsOpen(false)}
          />
        )}
        {/* 工作流编辑画布是纯配置界面（不存在执行），不再挂执行日志入口；
         *  执行期的日志仍由项目画布的 GlobalStepLogPanel 承担。 */}
        {/* 顶部「📋 查看 JSON」触发的全屏 modal。
            派生数据由 `sourceModalData` (useMemo) 给出:
              - 顶层 detail: graph/rawJson 来自 detail
              - sub 视图: graph 来自 sub-detail, rawJson 切自父级的
                definitions.subgraphs[uid] 这一项
            关闭则清空 viewJsonOpen。 */}
        {viewJsonOpen && sourceModalData && (
          <SourceModal
            data={sourceModalData}
            onClose={() => setViewJsonOpen(false)}
          />
        )}
      </div>
    </FullScreenLayer>
  );
}

/* ── Public API ── */
