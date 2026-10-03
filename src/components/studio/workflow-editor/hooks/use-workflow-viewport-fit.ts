"use client";
/* ── 画布聚焦（打开工作流 / 子工作流时把视口对准真实内容）──
 *
 *  算式本体在 subgraph-viewport.ts（纯函数 + 单测）；这里只放与 React Flow
 *  store 打交道的部分：挑出参与包围盒的节点、读容器尺寸、下发视口，
 *  以及「反复算、直到收敛」的调度。
 *
 *  为什么必须「反复算、直到收敛」而不是一次性 fitView：节点是分批测量的
 *  （视口裁剪下只有看得见的节点会挂载并被量到尺寸）。第一帧里测量的范围
 *  恰好就是上一个视图留下的那块视口，据此 fit 会把整张图当成「就那么大」，
 *  子图内容于是停在视野外（ISSUE #394）。
 *
 *  容器尺寸必须取自**本实例**的 React Flow store（`useStoreApi()` 的
 *  `width` / `height`）：页面上还有工作流库详情面板的画布预览，用
 *  `document.querySelector(".react-flow")` 会命中文档顺序里第一个，
 *  等于拿别人的容器宽高算自己的居中（ISSUE #717）。 */
import { useCallback, useEffect, useRef } from "react";
import { useStoreApi, type ReactFlowInstance } from "@xyflow/react";
import { onNextFrame } from "~/lib/next-frame";
import {
  computeFitViewport,
  createFitOnceScheduler,
  createFitSettleStepper,
  normalizeBounds,
  type Bounds,
  type FitBoundsNode,
} from "../subgraph-viewport";

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

/** 画布视口贴合的调度与出口（供 <WorkflowEditorBody> 使用）。
 *
 *  @param fitKey —— 本次聚焦的图的 key（`detail.id`；顶层视图传 `"__root__"`），
 *    切换子图自然重新聚焦。
 *  @param nodesCount —— 当前图节点数；为 0 时不动作（节点是异步填充的）。
 */
export function useWorkflowViewportFit(params: {
  rf: ReactFlowInstance;
  canvasSettings: { minZoom: number; maxZoom: number };
  fitKey: string;
  nodesCount: number;
}) {
  const { rf, canvasSettings, fitKey, nodesCount } = params;
  /* 本实例的容器尺寸从 React Flow **本实例的 store** 取，不用
   *  document.querySelector —— 判据见文件头与 applyFitViewport 的注释。 */
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

  /* 每打开一次工作流 / 子工作流就贴合内容一次。放在 `nodes` 之后，
   * 避免在声明之前引用它（否则触发 react-hooks/immutability 规则）。 */
  useEffect(() => {
    if (nodesCount === 0) return;
    /* nodes 是异步填充的：依赖里若没有 nodes.length，effect 会在数组还空着时
     * 提前 return，且此后不再触发，画布将永远停在默认缩放。这里按「图的 key」
     * 记录已经 fit 过的那份图——首次拿到节点、或切到另一份图/子图时才 fit，
     * 用户后续增删节点不会反复抢走其视角。
     *
     * 「已 fit」记的是**下发过视口**的图，不是「排过程」的图：下面的节点同步
     * effect 会让 nodes.length 变化、进而重跑本 effect，重跑前的 cleanup 取消
     * 掉还没触发的那一帧 rAF。排程即记账会把这次聚焦吃掉（视口留在上一份图，
     * 表现就是「打开子工作流没聚焦到」，ISSUE #394）。 */
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
  }, [rf, rfStore, canvasSettings, fitKey, nodesCount]);

  return { fitToContent, recenterCanvas };
}
