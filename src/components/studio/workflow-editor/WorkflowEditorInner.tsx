"use client";
/* Extracted WorkflowEditorInner (the inner editor that must live inside
 * ReactFlowProvider).  Node renderers / registries moved to
 * wf-editor-nodes.tsx (WorkflowGroupNode / WorkflowIoPortNode / WorkflowNoteNode +
 * workflowNodeTypes / workflowEdgeTypes + shared layout constants).
 * Originally inside WorkflowCanvasEditor.tsx. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { refreshCustomNodes } from "@/config/custom-nodes";
import { SourceModal } from "../SourceModal";
import { api } from "~/trpc/react";
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
import { GlobalStepLogPanel } from "../project-canvas/GlobalStepLogPanel";
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
} from "./WorkflowStores";

import { WorkflowEditorTopBar } from "./WorkflowEditorTopbar";
import { WorkflowIoPreviewPanel } from "../WorkflowIOPreviewPanel";
import { WorkflowEditorCanvas } from "./WorkflowEditorCanvas";
import { buildInitialNodes } from "./workflow-editor-build-nodes";
import { useWorkflowDetailLoader } from "./workflow-editor-detail-loader";
import { useWorkflowDerivedData } from "./workflow-editor-derived";
import { useWorkflowPersistence } from "./workflow-editor-persistence";

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
 *  2026-08-11: user request — once the viewport is zoomed out to ≤ 60%
 *  the entire grid (minor + major) is hidden.  At that scale the canvas
 *  reads as a whole-workflow map and the grid just adds clutter, so we
 *  short-circuit and render nothing.  Note `<ReactFlow>` minZoom is 0.15
 *  (see ZoomIndicator), so we never hit a zoom where we'd still want the
 *  grid but it's missing for technical reasons. */
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
  const [paramMap, setParamMap] = useState<Record<string, string>>({});
  /* workflowIO / ioEditMode / ioPreviewOpen 已收进 Zustand IOEditStore。
   * 这里用 selector 订阅成响应式局部变量，让下方既有合并/预览/保存逻辑零改动。 */
  const workflowIO = useIOEditStore(selectWorkflowIO);
  const ioEditMode = useIOEditStore(selectIoEditMode);
  const ioPreviewOpen = useIOEditStore(selectIoPreviewOpen);
  const savePatch = api.workflow.update.useMutation();
  /* Side-panel toggle for the IO preview (2026-08-09).  Independent of
   *  `ioEditMode` so the author can A/B toggle before vs. after opening
   *  the panel.  Default closed — the canvas already gives a busy
   *  experience and we don't want to pile on a second floating panel
   *  before the user asks for one. */
  /* R-ardot95 (2026-08-17): canvas-settings panel state — sits next to
   *  ioPreviewOpen / viewJsonOpen as a sibling overlay opened by a gear
   *  button in the canvas chrome.  Default closed. */
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  /* The settings hook owns a single localStorage-backed settings object
   *  that drives CanvasGrid / CanvasRulers / ZoomIndicator / MiniMap.
   *  Until `hydrated` is true we render with defaults so SSR / first
   *  paint don't briefly show saved values before the read completes. */
  const { settings: canvasSettings, update: updateCanvasSetting, reset: resetCanvasSettings, hydrated: canvasSettingsHydrated } = useCanvasSettings();
  /* 2026-08-11 R40: 画布顶部「📋 查看 JSON」按钮 — 复用 SourceModal。
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
  const setIoEditMode = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi.setState((state) => ({ ioEditMode: typeof v === "function" ? v(state.ioEditMode) : v })),
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
  const [subgraphStack, setSubgraphStack] = useState<{ uid: string; name: string }[]>([]);
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

  /* 2026-08-11 R42: 子工作流「查看 JSON」要支持 RAW。
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

  /* 2026-08-29：「查看源文件」要展示**磁盘上的原始 JSON**，而不是 /prompt 用的
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
  /* R-ardot106 (2026-08-17): MiniMap → main-viewport single-click jump.
   *  Pairs with <MiniMap pannable zoomable onClick={onMiniMapJump} /> below. */
  const onMiniMapJump = useMiniMapJump(rf);

  /* 2026-08-06 R3: monotonically-increasing token so background fetches
   *  can't overwrite the current fetchDetail's commit.  Bumped inside
   *  fetchDetail; whichever invocation holds the highest number
   *  when its response arrives is the one allowed to write to state.
   *  This guarantees the cacheKey upgrade never sits behind "background
   *  fetch silently updates storage while UI remains stale". */
  const latestRequestIdRef = useRef(0);

  /* Centre the viewport on the *middle* workflow nodes only (never the
   *  left/right boundary-pin rails / their wfGroup frames — see below).
   *  Reads the live node list from React Flow's store (`rf.getNodes()`)
   *  instead of the React `nodes` closure, so it can be called both from
   *  the auto-fit effect on subgraph entry AND from the manual "重置布局"
   *  (reset layout) button after the nodes have been re-laid-out by the
   *  sync effect — no stale-closure / render-order races. */
  const fitToMiddle = useCallback(() => {
    const all = rf.getNodes();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasMiddle = false;
    for (const n of all) {
      // Skip boundary-pin labels and their wfGroup frames — they live in
      // the left/right rails (minX - RAIL_GAP) and would otherwise pull
      // the centre leftward and shrink the workflow to a sliver.
      if (n.type === "wfIoPort") continue;
      if (String(n.id).startsWith("grp:bpin:")) continue;
      hasMiddle = true;
      const w = Number(n.measured?.width ?? n.width ?? 240);
      const h = Number(n.measured?.height ?? n.height ?? 80);
      const x = n.position.x;
      const y = n.position.y;
      if (x < minX) minX = x;
      if (x + w > maxX) maxX = x + w;
      if (y < minY) minY = y;
      if (y + h > maxY) maxY = y + h;
    }
    if (!hasMiddle || !Number.isFinite(minX)) {
      void rf.fitView({ padding: 0.10, duration: 0 });
      return;
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const containerW = document.querySelector(".react-flow")?.clientWidth ?? 1200;
    const containerH = document.querySelector(".react-flow")?.clientHeight ?? 700;
    // Zoom that fully encloses the middle bbox with ~12% margin on each
    // side, floored at 0.35 so wide workflows stay legible.
    let zoom = Math.min((containerW * 0.76) / bboxW, (containerH * 0.76) / bboxH, 1.5);
    if (zoom < 0.35) zoom = 0.35;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    void rf.setViewport(
      { x: containerW / 2 - zoom * centerX, y: containerH / 2 - zoom * centerY, zoom },
      { duration: 0 }
    );
  }, [rf]);

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
    setIoEditMode,
    setIoPreviewOpen,
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
  /* 2026-08-25: 单一格式，移除 RAW/API viewMode 与 apiLayoutOverrides 状态 */

  /* Derived lookups: raw-node metadata map, view-scoped detail (RAW / API),
   * and per-node output-slot names. */
  const { rawMetaById, scopeDetail, outSlotNameById } = useWorkflowDerivedData(detail);

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

  const initialNodes: Node[] = useMemo(
    () =>
      buildInitialNodes({
        detail,
        scopeDetail,
        rawMetaById,
        outSlotNameById,
        paramMap,
        onEnterSubgraph,
      }),
     
    [detail, scopeDetail, rawMetaById, outSlotNameById, paramMap, onEnterSubgraph]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /* Fit-to-middle once per workflow/subgraph open. Placed after `nodes`
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
    // Defer one frame so ReactFlow has measured the viewport and laid
    // nodes out before we fit.
    const raf = requestAnimationFrame(() => {
      fitToMiddle();
      // One final settle (some React Flow minor versions re-trigger
      // their own fitView once measurements resolve a frame later; this
      // reasserts ours).
      requestAnimationFrame(() => fitToMiddle());
    });
    return () => cancelAnimationFrame(raf);
  }, [rf, detail?.id, fitToMiddle, nodes.length]);

  /* 2026-08-25: lazy edge interactivity.  defaultEdgeOptions in the canvas
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

  /* Sync nodes/edges when detail (or paramMap) changes.  useNodesState only
   * takes initialNodes on mount, so when the workflow detail arrives async
   * we have to push the freshly computed initialNodes into the flow state. */
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(buildEdges(scopeDetail, initialNodes, outSlotNameById));
  }, [initialNodes, scopeDetail, outSlotNameById, setNodes, setEdges]);

  const { resetLayout, handleSave, onNodeDragStop } = useWorkflowPersistence({
    workflowId,
    detail,
    setDetail,
    scopeDetail,
    setNodes,
    paramMap,
    workflowIO,
    fitToMiddle,
    savePatch,
    onSave,
    onClose,
    setSaving,
    setError,
  });
;

  /* IO-preview merge (2026-08-09).  IMPORTANT: this useMemo MUST sit
   *  BEFORE any early-return (loading / error below) so the hook order
   *  is stable across renders — otherwise React fires "Rendered more
   *  hooks than during the previous render" the moment the loading
   *  state flips from true → false.  `workflowIO` (local state) only
   *  carries the four identity fields written by toggleIO; the server
   *  returns an enriched map (type / defaultValue / nodeTitle /
   *  multiline).  The preview panel needs the union: a freshly-toggled
   *  pin must inherit the server-side enrichment so `controlForEntry`
   *  picks the right widget, while an un-saved label rename from local
   *  state must win immediately. */
  /* Loading state */
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--color-canvas)">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          <p className="text-sm text-gray-400">加载工作流节点…</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--color-canvas)">
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
      </div>
    );
  }

  /* (IO-preview merge was hoisted above the loading/error early-returns
   *  so React hook order stays stable — see comment at the top of the
   *  component for the full rationale.) */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-(--color-canvas)">
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
        {/* IO preview side panel (2026-08-09).  Renders the same
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
         *  DATA MERGE (2026-08-09).  The local `workflowIO` state only
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
            detailIOMap={detail.workflowIO ?? null}
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
          onEdgeClick={onEdgeClick}
        />

        {/* Floating instruction tooltip */}        {/* Floating instruction tooltip */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-[11px] text-gray-400 backdrop-blur-sm">
          点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
        </div>

        {/* R-ardot95: right-edge canvas settings drawer.  Portaled to
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

        {/* 执行日志入口：整块由画布「日志面板」开关控制，且日志以弹窗呈现
         *  而非常驻面板，所以不与节点主体争抢画布空间，也不需要逐节点开关。 */}
        <GlobalStepLogPanel />

        {/* 2026-08-11 R40: 顶部「📋 查看 JSON」触发的全屏 modal。
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
    </div>
  );
}

/* ── Public API ── */
