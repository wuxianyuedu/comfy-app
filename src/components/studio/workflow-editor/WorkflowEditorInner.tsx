"use client";
/* Extracted WorkflowEditorInner (the inner editor that must live inside
 * ReactFlowProvider).  Node renderers / registries moved to
 * wf-editor-nodes.tsx (WorkflowGroupNode / WorkflowIoPortNode / WorkflowNoteNode +
 * workflowNodeTypes / workflowEdgeTypes + shared layout constants).
 * Originally inside WorkflowCanvasEditor.tsx. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNodesState, useEdgesState, useReactFlow,
  type Connection as ReactFlowConnection, type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { refreshCustomNodes } from "@/config/custom-nodes";
import { SourceModal } from "../SourceModal";
import type { WorkflowDetail,
  WorkflowIOParam,
} from "../workflow-types";
import { buildEdges,
} from "../workflow-utils";
import { useMiniMapJump } from "../shared/useMiniMapJump";
import {
  useCanvasSettings,
  CanvasSettingsPanel,
} from "../canvas/WorkflowCanvasSettings";
import {
  WFStoresProvider,
  getIOEditApi,
  getRgthreeApi,
  getViewerApi,
  useIOEditStore,
  selectIoEditMode,
  selectWorkflowIO,
  selectIoPreviewOpen,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  callStoreAction,
} from "./WorkflowStores";

import { WorkflowEditorTopBar } from "./WorkflowEditorTopbar";
import { WorkflowIoPreviewPanel } from "../WorkflowIOPreviewPanel";
import { WorkflowEditorCanvas } from "./WorkflowEditorCanvas";
import { buildInitialNodes } from "./workflow-editor-build-nodes";
import { useWorkflowDetailLoader } from "./hooks/use-workflow-detail-loader";
import { useParamMapping } from "./hooks/use-param-mapping";
import { entryIdFromParamNodeId } from "~/lib/workflow-param-mapping";
import { buildParamEdges } from "./workflow-param-edges";
import { buildParamNodes } from "./workflow-param-nodes";
import { useWorkflowDerivedData } from "./workflow-editor-derived";
import { enrichFromViewNodes, isMachineName, type ExposedAliasBase } from "./io-exposure";
import { sanitizeComboLabel } from "../workflow-utils";
import { resolveWorkflowMode } from "@/lib/workflow-types";
import { ioLabel, type WorkflowIOEntry } from "../shared/workflow-io";
import { useWorkflowPersistence } from "./hooks/use-workflow-persistence";
import { useWorkflowSaveMutation } from "./hooks/use-workflow-save";
import { FullScreenLayer } from "../fullscreen/FullScreenLayer";
import {
  computeFitViewport,
  createFitSettleStepper,
  normalizeBounds,
  type Bounds,
  type FitBoundsNode,
} from "./subgraph-viewport";

/* ── Canvas grid ──
 *  Two stacked native <Background> layers so the grid pans / zooms with
 *  the viewport (an earlier CSS-on-`.react-flow__pane` grid was static
 *  because the pane is the un-transformed interaction layer):
 *
 *    · minor — one line every GRID_CELL px  (1 cell)
 *    · major — one line every 10 cells, slightly thicker + brighter
 *
 *  Cell size = 10px canvas units so common node widths (e.g. a 230px
 *  MarkdownNote) line up cleanly on integer cell counts (23 cells),
 *  which makes "snap every N cells" meaningful instead of an odd fraction.
 *
 *  `BackgroundVariant.Lines` draws a full-height + full-width segment per
 *  pattern tile, so the tiles butt up into continuous orthogonal rules —
 *  not the `+` constellation an older comment in this file claimed.
 *
 *  Layer order matters: the major grid is rendered last so it paints over
 *  the minor one.  Only the minor layer carries `bgColor`; the major layer
 *  must stay `transparent` or it would blank out the layer beneath it.
 *
 *  Below ~0.65 zoom a 10px cell collapses to <6.5 screen px and the fine
 *  grid turns into noise, so its alpha fades out while the 10-cell major
 *  rules stay put and keep the canvas readable.  The selector returns an
 *  already-quantised alpha so panning/zooming only re-renders when the
 *  fade actually steps.
 *
 *  user request — once the viewport is zoomed out to ≤ 60%
 *  the entire grid (minor + major) is hidden.  At that scale the canvas
 *  reads as a whole-workflow map and the grid just adds clutter, so we
 *  short-circuit and render nothing.  Note `<ReactFlow>` minZoom is 0.15
 *  (see ZoomIndicator), so we never hit a zoom where we'd still want the
 *  grid but it's missing for technical reasons. */
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
  nodes: readonly { id: string; type?: string; position: { x: number; y: number };
    measured?: { width?: number; height?: number }; width?: number; height?: number;
    style?: { width?: number | string; height?: number | string } }[],
): FitBoundsNode[] {
  const out: FitBoundsNode[] = [];
  for (const n of nodes) {
    if (n.type === "wfIoPort") continue;
    if (String(n.id).startsWith("grp:bpin:")) continue;
    out.push(n);
  }
  return out;
}

/** 下发一次视口。没有可测量的节点时退回 React Flow 自己的 fitView。 */
function applyFitViewport(
  rf: { fitView: (options?: { padding?: number; duration?: number }) => unknown;
    setViewport: (viewport: { x: number; y: number; zoom: number },
      options?: { duration?: number }) => unknown },
  bounds: Bounds | null,
): void {
  const container = document.querySelector(".react-flow");
  const viewport = computeFitViewport(bounds, {
    width: container?.clientWidth ?? 0,
    height: container?.clientHeight ?? 0,
  });
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
  /* 3 per-instance Zustand stores, created once per mount.  useState lazy
   *  initializer keeps them stable without touching a ref during render
   *  (react-hooks/refs). */
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
      <WorkflowEditorBody workflowId={workflowId} onClose={onClose} onSave={onSave} />
    </WFStoresProvider>
  );
}

interface WFStoresHelper {
  io: ReturnType<typeof createIOEditStore>;
  rgthree: ReturnType<typeof createRgthreeGroupsStore>;
  viewer: ReturnType<typeof createNodeJsonViewerStore>;
}

/* 内层：全部既有逻辑。经 getIOEditApi/getRgthreeApi/getViewerApi 直读直写
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
  const ioApi = getIOEditApi();
  const rgthreeApi = getRgthreeApi();
  const viewerApi = getViewerApi();
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
  /* Side-panel toggle for the IO preview.  Independent of
   *  `ioEditMode` so the author can A/B toggle before vs. after opening
   *  the panel.  Default closed — the canvas already gives a busy
   *  experience and we don't want to pile on a second floating panel
   *  before the user asks for one. */
  /* canvas-settings panel state — sits next to
   *  ioPreviewOpen / viewJsonOpen as a sibling overlay opened by a gear
   *  button in the canvas chrome.  Default closed. */
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  /* The settings hook owns a single localStorage-backed settings object
   *  that drives CanvasGrid / CanvasRulers / ZoomIndicator / MiniMap.
   *  Until `hydrated` is true we render with defaults so SSR / first
   *  paint don't briefly show saved values before the read completes. */
  const { settings: canvasSettings, update: updateCanvasSetting, reset: resetCanvasSettings, hydrated: canvasSettingsHydrated } = useCanvasSettings();
  /* 画布顶部「📋 查看 JSON」按钮 — 复用 SourceModal。
   *  数据直接从 `detail.graph/rawJson` 读 (缓存里的磁盘已保存版本)，
   *  无需网络请求；当前未保存的画布修改不在内，文案里写明。 */
  const [viewJsonOpen, setViewJsonOpen] = useState(false);
  const setWorkflowIO = useCallback(
    (updater: Record<string, WorkflowIOParam> | ((prev: Record<string, WorkflowIOParam>) => Record<string, WorkflowIOParam>)) => {
      ioApi.setState((state) => ({
        workflowIO: typeof updater === "function" ? updater(state.workflowIO) : updater,
      }));
    },
    [ioApi]
  );
  const setIoPreviewOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi.setState((state) => ({ ioPreviewOpen: typeof v === "function" ? v(state.ioPreviewOpen) : v })),
    [ioApi]
  );
  const [error, setError] = useState("");
  /* Sync the on-disk custom-node manifest into the in-memory registry once
   *  on mount so <PackageFooter> can resolve every node's `classType` →
   *  package mapping without each node firing its own /api fetch. The
   *  manifest is already cached server-side after the first parse, so
   *  this is one cheap roundtrip per page open. */
  useEffect(() => {
    refreshCustomNodes().catch(() => undefined);
  }, []);
  /* Subgraph navigation stack.  Empty while viewing the top-level workflow.
   *  Each entry is {uid, name} for breadcrumb display; clicking a crumb
   *  pops back to that level. */
  const [subgraphStack, setSubgraphStack] = useState<
    { uid: string; name: string; nodeId: string }[]
  >([]);
  /* The root workflow's display name is captured on the FIRST top-level
   *  fetch and then preserved across subgraph navigation, so the breadcrumb
   *  can always render "<root workflow> / <subgraph 1> / <subgraph 2> …".
   *  Without this, drilling into a subgraph rewrites the leading crumb to
   *  the subgraph's own name (since `detail.name` becomes the subgraph's
   *  title), producing a confusing "subA / subA" duplicate and triggering
   *  the recursive "click subgraph name → enter another layer" bug. */
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

  /* 「查看源文件」要展示**磁盘上的原始 JSON**，而不是 /prompt 用的
   * 可执行图（`detail.graph`）—— 用户点这个按钮是想核对 ComfyUI 保存的源文件
   * （nodes[] / links[] / widgets_values）。所以这里取 `detail.rawJson`；
   * 只有纯 API 导入（rawJson 为 null）才回退到 graph，并标记 isApiFallback
   * 让弹窗如实说明。sub 视图同理。 */
  const sourceModalData = useMemo<{
    name: string;
    source: unknown;
    isSubgraph: boolean;
    isApiFallback: boolean;
  } | null>(() => {
    if (!detail) return null;
    const isSubgraphView = subgraphStack.length > 0;
    const raw: unknown = (() => {
      if (!isSubgraphView) return detail.rawJson ?? null;
      /* sub 视图：源文件 = 父 rawJson 的 definitions.subgraphs[subUid]（见上方
       * subgraphRawContext 的注释）。 */
      const ctx = subgraphRawContext;
      if (!ctx) return null;
      const subs = (ctx.parentRawJson as { definitions?: { subgraphs?: Record<string, unknown> } } | null)
        ?.definitions?.subgraphs;
      if (!subs) return null;
      return (
        subs[ctx.subUid] ??
        Object.values(subs).find((s) => (s as { id?: unknown } | null)?.id === ctx.subUid) ??
        null
      );
    })();
    return {
      name: detail.name ?? "工作流",
      source: raw ?? detail.graph,
      isSubgraph: isSubgraphView,
      isApiFallback: raw == null,
    };
  }, [detail, subgraphStack.length, subgraphRawContext]);

  /* After fitView completes, lock the viewport onto the middle (real
   *  WorkflowNode / WorkflowSubgraph / wfNote / wfGroup) nodes.  We (a) run
   *  rf.fitView WITHOUT passing a `nodes` filter — that option was
   *  unreliable across React Flow v12 minor versions and made the
   *  viewport randomly include stray boundary pins, (b) immediately
   *  compute the middle-node bbox ourselves and call setViewport so
   *  the centre is guaranteed to land on the real workflow regardless
   *  of what the three-block rail layout did to the canvas bounds.
   *  Also enforce a *minimum* zoom of 0.35 — wide workflows (130+ nodes,
   *  bbox ~7000 px vs a 1280 px viewport) otherwise auto-shrink to
   *  ~0.15x where every note collapses to ~5–15 px and becomes
   *  indistinguishable from background.  Re-runs on subgraph
   *  navigation so a cramped child graph still fits. */
  const rf = useReactFlow();
  /** 已自动 fit 过的图的 key（detail.id），而非布尔——切换子图时要重新 fit。 */
  const fittedRef = useRef<string | null>(null);
  /* MiniMap → main-viewport single-click jump.
   *  Pairs with <MiniMap pannable zoomable onClick={onMiniMapJump} /> below. */
  const onMiniMapJump = useMiniMapJump(rf);

  /* monotonically-increasing token so background fetches
   *  can't overwrite the current fetchDetail's commit.  Bumped inside
   *  fetchDetail; whichever invocation holds the highest number
   *  when its response arrives is the one allowed to write to state.
   *  This guarantees the cacheKey upgrade never sits behind "background
   *  fetch silently updates storage while UI remains stale". */
  const latestRequestIdRef = useRef(0);

  /* 把视口对准「当前视图里真实有内容的节点」。
   *
   *  两个调用方：进入工作流 / 子工作流后的自动聚焦（见下方 effect），
   *  以及画布右上角「🎯 居中」按钮 —— 作者把节点拖出视野或缩得太小之后
   *  需要一条回到内容处的出口。纯视口动作：不移动节点、不写库。 */
  const fitToContent = useCallback(() => {
    applyFitViewport(rf, normalizeBounds(collectFitTargets(rf.getNodes()), FIT_FALLBACK_SIZE));
  }, [rf]);

  /* 「重新居中」按钮。延后一帧再算：React Flow 在下一帧才提交最新的测量
   *  结果，直接算会用到上一帧的尺寸（对刚展开/折叠过节点的画布尤其明显）。 */
  const recenterCanvas = useCallback(() => {
    requestAnimationFrame(() => fitToContent());
  }, [fitToContent]);

  /* Fetch workflow detail (or subgraph detail when navigating into one).
   * Performance: a per-session (sessionStorage) cache keyed by URL lets a
   * re-opened canvas paint instantly without waiting on the network. The
   * first open still benefits from the server-side LRU cache (see
   * src/lib/server-cache.ts). On a cache hit we render immediately and then
   * refresh the stored copy in the background without disturbing the UI. */
  const {
    fetchDetail,
    forceReloadDetail,
    onEnterSubgraph,
    onExitSubgraph,
  } = useWorkflowDetailLoader({
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
;

  /* Convert graph → flow nodes.  Rendering order (back→front):
   *   groups (frames) → notes (annotations) → real graph nodes (always on top).
   *  Layout strategies for the real nodes, in priority order:
   *   1. **Saved positions** (raw imports): use the original ComfyUI coordinates
   *      verbatim so the canvas looks exactly like the user arranged it.
   *   2. **Auto layout (BFS levels)** when only API JSON was provided. */
  /* Hoisted raw meta + slot-name table — also referenced from the edges
   * useEffect below, so we keep them at component scope (not inside the
   * initialNodes memo). */
  /* 单一格式，移除 RAW/API viewMode 与 apiLayoutOverrides 状态 */

  /* Derived lookups: raw-node metadata map, view-scoped detail (RAW / API),
   * and per-node output-slot names. */
  const { rawMetaById, scopeDetail, outSlotNameById } = useWorkflowDerivedData(detail);

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

  /* 富化下发的别名判定基准同步进 IOEdit store。
   *
   *  本地 `workflowIO` 里存的是勾选那一刻写进去的显示名，其中一部分是修复前
   *  固化的机器名（`value_1` / `image`）。判定「本地这一串该不该让位给富化名」
   *  需要同一份事实源（服务端富化 / 视图就地派生）给出的三样东西：
   *    · `name`          原始槽位名；
   *    · `enrichedLabel` 富化链现在的显示名 —— 与槽位名不同就说明本层确实有
   *                      作者命名，本地存着别名时该让位；
   *    · `slotLabel`     本层槽位上作者写的业务名（富化链够不着，但足以证明
   *                      本层有作者命名）。
   *  缺了这份基准，任何一次写入（切换 seed 的随机值/固定值、改必填、改值）
   *  都会把旧名字当作作者命名落库，显示名随即退回 `value_1`（ISSUE #349）。 */
  useEffect(() => {
    const base: Record<string, ExposedAliasBase> = {};
    for (const [key, entry] of Object.entries<WorkflowIOEntry>(ioDetailMap)) {
      const name = entry?.name;
      if (typeof name !== "string" || !name) continue;
      const enrichedLabel = ioLabel(entry);
      const slotLabel = entry?.slotLabel;
      base[key] = {
        name,
        ...(enrichedLabel ? { enrichedLabel } : {}),
        ...(slotLabel ? { slotLabel } : {}),
      };
    }
    ioApi.getState().setAliasBase(base);
  }, [ioDetailMap, ioApi]);

  /* 客户端兜底：富化下发的每一条本地条目，落库前/写入前再判一次「label 是不是
   *  机器名」，是就摘掉。
   *
   *  服务端读取出参时已经就地纠正过（读取时才能纠正，不改写库里数据），但本地
   *  store 里躺的仍是**回读时**那份带脏 label 的条目：取消勾选再勾选、下钻子图
   *  再回来、或富化还没到就先改了 seed 行为，都会让这串机器名以「作者命名」的
   *  名义被整体写回，显示名随即退回 `value_1`（ISSUE #349 的复现路径）。
   *  这里做的是同一条判定，只是发生在富化到达之后的本地态上 —— 判据只看事实
   *  源，不依赖「我们是否记得写过这个键」，所以任何路径重放都能挡下。
   *
   *  经 callStoreAction 调用：本动作是后加进 store 的，而 store 实例在挂载时
   *  创建一次、其动作集合也随之定格；热更新后未重载的旧窗口会拿到缺这个动作的
   *  实例（见 callStoreAction 注释）。那种情况下跳过本次兜底、等重载后再生效，
   *  不让一次时序问题把整个编辑器打成错误页。 */
  useEffect(() => {
    if (!detail) return;

    callStoreAction(ioApi, "purgeMachineNames", (state) =>
      state.purgeMachineNames((key, entry) => {
        const facts = ioDetailMap[key];
        const enriched = facts ? sanitizeComboLabel(ioLabel(facts)) : undefined;
        const slot = facts?.slotLabel ? sanitizeComboLabel(facts.slotLabel) : undefined;
        /* 宿主类名优先取富化事实源；富化还没到时退到条目自身记录的类名 ——
         *  「封装节点的 `value_N` 槽位是机器名」这条判据不依赖作者名回收，
         *  因此不能只在富化到场时才成立（ISSUE #349）。 */
        const classType = facts?.classType ?? entry.classType;
        if (
          isMachineName(entry.label, {
            name: entry.name,
            ...(enriched ? { enrichedLabel: enriched } : {}),
            ...(slot ? { slotLabel: slot } : {}),
            ...(classType ? { classType } : {}),
          })
        ) {
          return true;
        }
        /* 无富化可比时（键漂移把脏值写进了 `name`，富化按这个键查不到东西）：
         *  只在「键尾 === name === label」这种三项自证的情况下摘 —— 真实 pin 名
         *  与键尾不一致的条目一律放过，宁可留一个脏名也不误删作者命名。
         *  没有这一步，图三里的 `1` 会永远粘在面板上（ISSUE #349）。 */
        if (entry.label === undefined) return false;
        const keyEntries = key.split("::");
        const keyTail = keyEntries.length >= 3 ? keyEntries.slice(2).join("::") : key;
        return keyTail === entry.name && entry.label === entry.name;
      })
    );
  }, [detail, ioDetailMap, ioApi]);

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
     
    [detail, scopeDetail, rawMetaById, outSlotNameById, paramMap, onEnterSubgraph, viewHostNodeId]
  );

  /* ── 对外参数映射：画布上的节点与连线 ──
   *
   * 勾选 IO 只做一件事：把 pin 暴露成「对外参数」（写 workflowIO 落库）。这些
   * 对外口在画布上是**一列接线卡片**（`wfParam` 节点）：卡片说「这个对外参数由
   * 哪些端口组成」，右侧端点拖到宿主节点的某一行即完成映射 —— 连线本身就是
   * 映射，与 `paramMap.source.mode:<模式>` 同一份事实源，没有第二套界面。
   *
   * 模式取工作流的 defaultMode：落点覆盖必须归属一个模式，没有模式时卡片不渲染
   * 端点、拖不出线（写入也是空操作）。卡片位置由宿主节点坐标派生、不可拖动。
   * 这些 hook 必须无条件调用（在下方 loading / error 的提前返回之前）。 */
  /* 生效模式：defaultMode → modes[0] → taskType（与库详情、项目画布节点同一口径，
   *  见 resolveWorkflowMode）。此前只认 defaultMode —— 工作流声明了模式但没写
   *  defaultMode 时这里是 null，卡片于是提示「先选模式才能连线」，而节点上（库里 /
   *  画布上）明明已经显示着「单图生视频」了，自相矛盾（ISSUE #355 复审）。 */
  const wiringMode = resolveWorkflowMode({
    modes: detail?.modes,
    defaultMode: detail?.defaultMode,
    taskType: detail?.taskType,
  });
  const paramMapping = useParamMapping({
    workflowId,
    io: workflowIO,
    mode: wiringMode,
    paramMap,
  });

  /* 卡片位置派生自宿主节点当前的画布坐标 —— 作者拖动宿主节点，卡片列跟着走。 */
  const hostPosById = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const node of graphNodes) out[node.id] = node.position;
    return out;
  }, [graphNodes]);

  /* 卡片与连线只在**内容真的变了**时才重建。
   *
   * `isManual` / `onReset` 这类回调进入 memo 依赖表会让 memo 形同虚设（外层每次
   * 渲染都可能给出新身份），而 `initialNodes` 每次渲染换新数组时，React Flow 的
   * 同步 effect 会跟着每一帧重跑 —— 渲染回路，浏览器里表现为卡死、测试里表现为
   * 堆爆。这里把「条目标识 + 当前模式 + 解析结果 + 作者连过的线」压成一个签名，
   * 签名不变就复用上一批对象，签名一变立即重建（回调闭包因此总是新鲜的）。 */
  const paramSignature = useMemo(
    () =>
      JSON.stringify({
        mode: wiringMode,
        entries: paramMapping.entries.map((entry) => entry.id),
        resolved: paramMapping.resolved,
        manual: paramMapping.mapping.manualByMode?.[wiringMode ?? ""] ?? {},
      }),
    [paramMapping.entries, paramMapping.resolved, paramMapping.mapping, wiringMode]
  );
  const paramWiring = useMemo(() => {
    const paramNodes = buildParamNodes({
      entries: paramMapping.entries,
      hostPosById,
      mode: wiringMode,
      /* 卡片上带类型的输出端口：类型取自当前落点，故把 resolved 与 io 一起给。 */
      resolved: paramMapping.resolved,
      io: workflowIO,
      isManual: paramMapping.isManual,
      onReset: (entryId: string) => paramMapping.resetToAuto(entryId),
    });
    /* 卡片集合即「哪些对外参数在当前视图里真的有宿主」—— 连线用它当闸门，
     * 否则子图内部节点的 nodeId 在顶层画布上不存在时会画出一条悬空线（视觉上
     * 就是图上多出一个没来历的节点）。 */
    const renderedCardIds = new Set(paramNodes.map((node) => node.id));
    return {
      nodes: paramNodes,
      edges: buildParamEdges({
        entries: paramMapping.entries,
        resolved: paramMapping.resolved,
        isManual: paramMapping.isManual,
        renderedCardIds,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 上面的签名即全部内容
  }, [paramSignature]);
  const paramNodes = paramWiring.nodes;
  const paramEdges = paramWiring.edges;

  /* 删除一条映射线 = 该对外参数「在这个模式下断开」。React Flow 的删除手势会先
   * 把它从本地 edges 拿掉，我们必须同步把状态写回 paramMap，否则下一帧同步
   * effect 又把它画回来（看起来像删不掉）。 */
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        const entryId = entryIdFromParamNodeId(edge.source);
        if (entryId) paramMapping.connect(entryId, null);
      }
    },
    [paramMapping]
  );

  /* 在画布上拉一条线：源必须是某张对外参数卡片，目标必须落在宿主节点的某个
   * 端口上（`targetHandle` 就是 ioKey）。别的连线一律拒绝 —— 画布上的图连线
   * 由工作流本身决定，作者的手工连线只表达「映射」。 */
  const onConnect = useCallback(
    (connection: ReactFlowConnection) => {
      const entryId = entryIdFromParamNodeId(connection.source);
      if (!entryId || !connection.targetHandle) return;
      const entry = paramMapping.entries.find((item) => item.id === entryId);
      if (entry?.nodeId !== connection.target) return;
      paramMapping.connect(entryId, connection.targetHandle);
    },
    [paramMapping]
  );

  /* 连线合法性闸门：没有模式时任何连线都不成立（禁止连线），落点也必须是
   * 该对外参数宿主节点上真实存在的端口。 */
  const isValidConnection = useCallback(
    (connection: ReactFlowConnection | Edge) => {
      if (!wiringMode) return false;
      const entryId = entryIdFromParamNodeId(connection.source ?? "");
      const target = "target" in connection ? connection.target : null;
      const targetHandle = "targetHandle" in connection ? connection.targetHandle : null;
      if (!entryId || !target || !targetHandle) return false;
      const entry = paramMapping.entries.find((item) => item.id === entryId);
      return entry?.nodeId === target && !!workflowIO?.[targetHandle];
    },
    [wiringMode, paramMapping.entries, workflowIO]
  );

  /* useNodesState 只接受挂载首帧的初值；后续同步统一走下面的 effect（初始图节点
   * 即为这一帧的初值，对外参数卡片等 detail 就绪后才会补上）。 */
  const [nodes, setNodes, onNodesChange] = useNodesState(graphNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const initialNodes: Node[] = useMemo(
    () => [...graphNodes, ...paramNodes],
    [graphNodes, paramNodes]
  );

  /* Sync nodes/edges when the graph or the mapping changes.  useNodesState only
   * takes its initial value on mount, so when the workflow detail arrives async
   * (or the author edits a wire) we have to push the freshly derived nodes into
   * the flow state ourselves.
   *
   * 图节点与对外参数卡片一起替换：卡片的位置由宿主节点坐标派生、`data` 里的
   * 回调每次现算，所以整批换掉即可 —— 位置没变的卡片在 React Flow 眼里仍是
   * 同一个节点，不会重挂 DOM。 */
  useEffect(() => {
    setNodes(initialNodes);
    setEdges([...buildEdges(scopeDetail, graphNodes, outSlotNameById), ...paramEdges]);
  }, [initialNodes, graphNodes, paramEdges, scopeDetail, outSlotNameById, setNodes, setEdges]);


  /* Fit-to-content once per workflow/subgraph open. Placed after `nodes`
   * so we don't reference it before declaration (react-hooks/immutability). */
  useEffect(() => {
    if (nodes.length === 0) return;
    /* nodes 是异步填充的：依赖里若没有 nodes.length，effect 会在数组还空着时
     * 提前 return，且此后不再触发，画布将永远停在默认缩放。这里按「图的 key」
     * 记录已经 fit 过的那份图——首次拿到节点、或切到另一份图/子图时才 fit，
     * 用户后续增删节点不会反复抢走其视角。 */
    const fitKey = detail?.id ?? "__root__";
    if (fittedRef.current === fitKey) return;
    fittedRef.current = fitKey;
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
      const { bounds, done } = stepper.next(() => collectFitTargets(rf.getNodes()));
      applyFitViewport(rf, bounds);
      if (done) return;
      raf = requestAnimationFrame(step);
    };
    /* Defer one frame so ReactFlow has measured the viewport and laid
     * nodes out before we fit. */
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rf, detail?.id, nodes.length]);

  /* lazy edge interactivity.  defaultEdgeOptions in the canvas
   *  sets deletable/reconnectable=false so untouched edges stay inert; the
   *  first click on an edge flips BOTH flags on (idempotent afterwards), so
   *  the user can still delete / re-connect it exactly as before while the
   *  graph never pays the interaction cost for edges nobody touches. */
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (edge.deletable === true && edge.reconnectable === true) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edge.id ? { ...e, deletable: true, reconnectable: true } : e
        )
      );
    },
    [setEdges]
  );

  /* 对外参数卡片的「已连线目标」高亮：卡片行上没有端点，靠宿主节点那一行
   * 的自带端口体现；这里只需保证被映射到的端口所在行能拿到 targetHandle
   * （WidgetInputRow 的 withHandle 已按 ioKey 挂 handle，无需额外标记）。 */

  const { resetLayout, handleSave, onNodeDragStop } = useWorkflowPersistence({
    workflowId,
    detail,
    setDetail,
    scopeDetail,
    setNodes,
    paramMap,
    workflowIO,
    fitToContent,
    savePatch,
    onSave,
    onClose,
    setSaving,
    setError,
  });
;

  /* Loading state */
  if (loading) {
    return (
      <FullScreenLayer
        zClass="z-50"
        className="flex items-center justify-center bg-(--color-canvas) pb-6"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          <p className="text-sm text-gray-400">加载工作流节点…</p>
        </div>
      </FullScreenLayer>
    );
  }

  if (error || !detail) {
    return (
      <FullScreenLayer
        zClass="z-50"
        className="flex items-center justify-center bg-(--color-canvas) pb-6"
      >
        <div className="text-center">
          <p className="text-red-400">{error ?? "未知错误"}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/15"
          >
            返回
          </button>
        </div>
      </FullScreenLayer>
    );
  }

  return (
    <FullScreenLayer
      zClass="z-50"
      className="flex flex-col bg-(--color-canvas) pb-6"
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
          setViewJsonOpen={setViewJsonOpen}
          resetLayout={resetLayout}
          resetParamWiring={() => paramMapping.resetAll()}
          hasParamWiring={paramMapping.hasManual}
          wiringMode={wiringMode}
          handleSave={handleSave}
          saving={saving}
          error={error}
        />

      {/* ── Canvas ── */}
      <div className="relative min-h-0 flex-1">
        {/* Subgraph drill-in / drill-out overlay: keep the parent graph fully
         *  visible and only paint a lightweight centered spinner card on top.
         *  This matches the requested UX: current content unchanged, then a
         *  loading screen, then the subgraph content. */}
        {subgraphLoading && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20">
            <div className="pointer-events-auto rounded-xl border border-white/10 bg-(--color-canvas)/90 px-6 py-4 shadow-2xl backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
                <span className="text-sm font-medium text-gray-200">加载子工作流…</span>
              </div>
            </div>
          </div>
        )}
        {ioEditMode && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-1.5 text-[12px] font-medium text-amber-100 shadow-lg backdrop-blur-sm">
            📌 IO 编辑模式：勾选节点参数前的复选框，即可将其暴露为工作流的「输入」或「输出」
          </div>
        )}
        {/* 子工作流下钻失败：内联错误提示，父图保持可见（绝不回退到工作流库） */}
        {subgraphError && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-[12px] text-rose-100 shadow-lg backdrop-blur-sm">
              <span>⚠ {subgraphError}</span>
              <button
                type="button"
                onClick={() => setSubgraphError("")}
                className="rounded px-1.5 py-0.5 text-rose-200 transition-colors hover:bg-white/10"
                aria-label="关闭"
              >
                ×
              </button>
            </div>
          </div>
        )}
        {/* IO preview side panel.  Renders the same
         *  DynamicWorkflowForm that CreatePanel / the canvas workflow node
         *  consume, fed by the **live** `workflowIO` state (not the cached
         *  server-side enrichment).  This lets the author toggle a
         *  checkbox on the canvas and immediately see the new row appear
         *  in the preview, plus rename any row's display label and watch
         *  it flow back into the persisted selection.  Compact mode to
         *  match the on-canvas rendering the user will see at run time.
         *
         *  Position: top-right, ~360px wide, max-h that respects the
         *  bottom toolbar.  z-30 so it sits above the MiniMap + Controls
         *  but below the save toast.  Pointer events on the panel itself
         *  are enabled; the wrapper stays pointer-events:none-equivalent
         *  only on the padding outside the panel (we use a single flex
         *  container, so the whole thing is interactive).
         *
         *  DATA MERGE.  The local `workflowIO` state only
         *  carries the four identity fields written by toggleIO — it
         *  does NOT have type/defaultValue/nodeTitle/multiline, those
         *  come from the server-side enrichment in
         *  `api/workflows/[id].route.ts`.  Without merging, every freshly
         *  toggled pin would render as a read-only `link` placeholder
         *  (controlForEntry falls through to "link" for type "*" with no
         *  scalar).  Solution: for each key in the local state, prefer
         *  `detail.workflowIO[key]` (already enriched), and overlay the
         *  local `label` on top so an un-saved rename wins immediately. */}
        {ioPreviewOpen && (
          <WorkflowIoPreviewPanel
            workflowIO={workflowIO}
            detailIOMap={ioDetailMap}
            modes={detail.modes ?? []}
            defaultMode={detail.defaultMode ?? null}
            onModesChange={(modes, defaultMode) => {
              /* 模式集合变更立即落库（与库详情「类型」同一存储），并同步
               * 本地 detail 让页签即时反映。被移除的模式在各 IO 条目上的
               * 覆盖层（modes[mode]）必须一并摘掉——页签栏只跟 modes 走，
               * 留下的无主覆盖会一直随 workflowIO 落库往返；清理结果随同
               * 一 PATCH 落库。 */
              const removedModes = (detail.modes ?? []).filter((m) => !modes.includes(m));
              const cleanedIO =
                removedModes.length > 0
                  ? ioApi.getState().purgeModeOverrides(removedModes)
                  : null;
              setDetail((prev) =>
                prev ? { ...prev, modes, defaultMode, taskType: defaultMode } : prev,
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
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onEdgesDelete={onEdgesDelete}
        />

        {/* Floating instruction tooltip */}        {/* Floating instruction tooltip */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-[11px] text-gray-400 backdrop-blur-sm">
          点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
        </div>

        {/* right-edge canvas settings drawer.  Portaled to
         *  document.body by the panel itself so it can sit above the
         *  WorkflowCanvasEditor root overlay stack (`z-50`); rendered
         *  only when the gear button is clicked. */}
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
              - sub 视图: graph 来自 sub-detail, rawJson 切自父
                rawJson.definitions.subgraphs[uid] (R42 修复)
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
