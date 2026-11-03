"use client";
/* 拆出来的 WorkflowEditorInner —— 内层编辑器，必须住在 ReactFlowProvider 里面。
 * 节点渲染器与注册表已移到 wf-editor-nodes.tsx（分组/IO 端口/便签节点、节点类型
 * 表、连线类型表与共享布局常量）。本组件是容器，纯逻辑编排收在 hooks/：
 * use-workflow-viewport-fit（画布聚焦）、use-workflow-graph-derivation（detail →
 * 图节点）、use-io-modes-commit（IO 模式落库）；过渡屏与浮层在 Overlays。 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNodesState, useEdgesState, useReactFlow, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { refreshCustomNodes } from "~/config/custom-nodes";
import { SourceModal } from "../SourceModal";
import type { WorkflowDetail } from "../workflow-types";
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
import { useWorkflowDetailLoader } from "./hooks/use-workflow-detail-loader";
import { useWorkflowGraphDerivation } from "./hooks/use-workflow-graph-derivation";
import { useWorkflowViewportFit } from "./hooks/use-workflow-viewport-fit";
import { useIoModesCommit } from "./hooks/use-io-modes-commit";
import { useIoEditActions } from "./hooks/use-io-edit-actions";
import { useSubgraphSourceModal } from "./hooks/use-subgraph-source-modal";
import { useWorkflowPersistence } from "./hooks/use-workflow-persistence";
import { useWorkflowSaveMutation } from "./hooks/use-workflow-save";
import { FullScreenLayer } from "../fullscreen/FullScreenLayer";
import { zClass } from "~/lib/shell/overlay-z";
import {
  CanvasHintTooltip,
  IoEditModeBanner,
  SubgraphErrorToast,
  SubgraphLoadingOverlay,
  WorkflowEditorErrorScreen,
  WorkflowEditorLoadingScreen,
} from "./WorkflowEditorCanvasOverlays";

/* ── 画布网格 ── 两层都原生 <Background>，网格才随视口平移/缩放（给
 *  `.react-flow__pane` 加 CSS 网格是静态的，pane 不做变换）。一格 = 10 画布单位，
 *  常见节点宽度落在整数格上；每 10 格一条粗线，最后绘制盖住细线，粗线层必须
 *  transparent（带 bgColor 会把下层刷白）。缩到约 0.65 以下细线淡出（返回量化后的
 *  透明度，只在跨档时重渲），60% 及以下整层隐藏；minZoom 是 0.15，不会拿不到档。 */

/* 外层：创建 3 个 per-instance Zustand store（经 createIOEditStore 等工厂），
 * 再经 <WFStoresProvider> 下发。状态判断逻辑与渲染子树都在这之下。 */
export function WorkflowEditorInner({
  workflowId,
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave?: () => void;
  workflowId: string;
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
      <WorkflowEditorBody onClose={onClose} onSave={onSave} workflowId={workflowId} />
    </WFStoresProvider>
  );
}

type WFStoresHelper = {
  io: ReturnType<typeof createIOEditStore>;
  rgthree: ReturnType<typeof createRgthreeGroupsStore>;
  viewer: ReturnType<typeof createNodeJsonViewerStore>;
};

/* 内层：全部既有逻辑。经 useIOEditApi/useRgthreeApi/useViewerApi 直读直写
 * store（hook 在 <WFStoresProvider> 之下才合法，故体逻辑用 *Api 访问）。 */
function WorkflowEditorBody({
  workflowId,
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave?: () => void;
  workflowId: string;
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
  /* IO 预览的侧栏开关。默认关闭 —— 画布信息量已经很大，用户没主动要之前不宜再叠
   *  浮动面板。与 `ioEditMode` 双向耦合：开预览一并进编辑模式，关预览一并退出；
   *  反方向成立（关编辑模式一并关预览）。耦合写在 store 的 `setIoEditMode` /
   *  `setIoPreviewOpen` 里。 */
  /* 画布设置面板的开关 —— 与 ioPreviewOpen / viewJsonOpen 并列，
   * 由画布外框上的齿轮按钮打开。默认关闭。 */
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
  /* IOEditStore 的两个受控出口（预览开关必须走 store 动作的判据
   * 见 use-io-edit-actions 文件头与 workflow-editor-topbar-config）。 */
  const { setWorkflowIO, setIoPreviewOpen } = useIoEditActions({ ioApi });
  const [error, setError] = useState("");
  /* 挂载时把磁盘上的自定义节点 manifest 同步进内存注册表一次，
   *  让 <PackageFooter> 能解析每个节点的「类型 → 所属包」映射，
   *  而不必让每个节点各自发一次 /api 请求。
   *  manifest 在首次解析后已经在服务端缓存，因此每次打开页面只花一次廉价往返。 */
  useEffect(() => {
    refreshCustomNodes().catch((error_) => {
      console.warn("[we] 节点清单刷新失败", error_);
    });
  }, []);
  /* 子工作流导航栈。查看顶层工作流时为空。
   *  每一项是 {uid, name}，供面包屑显示；点某一级会退回到那一层。 */
  const [subgraphStack, setSubgraphStack] = useState<
    Array<{ name: string; nodeId: string; uid: string }>
  >([]);
  /* 根工作流的显示名在**第一次**顶层拉取时记下，之后跨子工作流导航一直保留，
   *  于是面包屑总能渲染成「<根工作流> / <子图> …」。否则钻进子图会把首段改写成
   *  子图自己的名字，出现「subA / subA」重名，并触发「点子图名字 → 再进一层」的
   *  递归 bug。 */
  const [rootWorkflowName, setRootWorkflowName] = useState<string>("");
  const [subgraphLoading, setSubgraphLoading] = useState(false);
  const [subgraphError, setSubgraphError] = useState("");

  /* 「查看 JSON」在子视图要支持 RAW：sub-detail 只有 API graph，**不带 rawJson** ——
   *  sub 的 LiteGraph json 存在父 `rawJson.definitions.subgraphs[uid]`，没有独立的
   *  sub rawJson。所以 drill-in 的一瞬缓存**父 rawJson + 当前 sub uid**，SourceModal
   *  据此拼出该项；顶层视图下该 state 为 null、直读 `detail.rawJson`。不注入
   *  `detail.rawJson`：detail 的语义是工作流本身的原始格式，注入父图会污染语义。 */
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

  /* 「查看源文件」弹窗的源数据派生（sub 视图拼父 rawJson 的 subgraph 项，
   * 详见 use-subgraph-source-modal）。 */
  const sourceModalData = useSubgraphSourceModal({
    detail,
    subgraphStackLength: subgraphStack.length,
    subgraphRawContext,
  });

  const rf = useReactFlow();
  /* 小地图 → 主视口的单击跳转。
   *  与下面 <MiniMap pannable zoomable onClick={onMiniMapJump} /> 配对使用。 */
  const onMiniMapJump = useMiniMapJump(rf);

  /* 单调递增的令牌，防止后台拉取覆盖当前 fetchDetail 的提交。
   *  在 fetchDetail 内部自增；响应到达时持有最大编号的那次调用才有权写 state。
   *  这保证缓存键的升级不会落在「后台拉取悄悄更新了存储、界面却还是旧的」之后。 */
  const latestRequestIdRef = useRef(0);

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

  /* 当前视图的宿主（外层封装）节点 id 链 —— 顶层为空串，下钻后是 `4`（或嵌套
   *  时的 `4:5`）。本层节点都是子图内部节点（id 形如 `1670`），带上它才能在勾选
   *  时落库「外层 + 内层」两个 id，运行期确定性还原成 `4:1670`（ISSUE #349 后续：
   *  不再靠「拿裸 id 扫一遍所有子图定义」兜底）。 */
  const viewHostNodeId = subgraphStack.at(-1)?.nodeId ?? "";

  /* 派生管线：raw meta / 按视图范围的详情 / 输出槽位名 / IO 富化数据源 /
   * 图节点；派生结果同时发布进 viewer / rgthree store
   * （详见 use-workflow-graph-derivation）。 */
  const { scopeDetail, outSlotNameById, ioDetailMap, graphNodes } = useWorkflowGraphDerivation({
    detail,
    paramMap,
    onEnterSubgraph,
    viewHostNodeId,
    workflowId,
    viewerApi,
    rgthreeApi,
    subgraphRawContext,
    subgraphStackLength: subgraphStack.length,
  });

  /* ── 对外参数映射：编辑器不碰 ──
   * 勾选 IO 只把 pin 暴露成对外参数（写 workflowIO 落库）。「对外参数 → 节点端口」
   * 的落点映射完全不在本编辑器编辑：画布上没有卡片，连线与落点在库详情「画布节点」
   * 页签。编辑器也不提供「恢复默认映射」，只把当前 `paramMap` **原样**保存回去
   * （见 useWorkflowPersistence），库内改过的落点不会被这里的一次保存抹掉。 */

  /* useNodesState 只接受挂载首帧的初值；后续同步统一走下面的 effect（初始图节点
   * 即为这一帧的初值，detail 就绪后才会补上）。 */
  const [nodes, setNodes, onNodesChange] = useNodesState(graphNodes);
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- useEdgesState 的泛型要从显式实参推断，去掉会退化成 never[]
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /* 画布上只有**工作流图**本身：图节点与图连线都来自工作流自身
   * （`buildInitialNodes` / `buildEdges`）。对外参数卡片与其映射线已从编辑器移除
   * —— 它们会浮在图节点之上挡掉一片，且落点编辑已收敛到工作流库的「画布节点」
   * 页签（用户口径：「彻底不显示」）。 */
  const initialNodes: Array<Node> = graphNodes;

  /* 图或映射变化时同步节点与连线。useNodesState 只在挂载时取初始值，
   * 所以工作流详情异步到达（或作者改了某条线）时，
   * 必须由我们自己把刚派生出的节点推进流程状态。 */
  useEffect(() => {
    setNodes(initialNodes);
    /* 连线只有一种来源：工作流图自身的 `buildEdges`。 */
    setEdges(buildEdges(scopeDetail, graphNodes, outSlotNameById));
  }, [initialNodes, graphNodes, scopeDetail, outSlotNameById, setNodes, setEdges]);

  /* 视口贴合：自动聚焦的排程 / 收敛 / 「居中」出口收在
   * use-workflow-viewport-fit（聚焦路径的容器尺寸口径判据也随迁到那里）。 */
  const { fitToContent, recenterCanvas } = useWorkflowViewportFit({
    rf,
    canvasSettings,
    fitKey: detail?.id ?? "__root__",
    nodesCount: nodes.length,
  });

  /* 惰性连线交互。画布的 defaultEdgeOptions 把 deletable / reconnectable
   *  都设成 false，未被动过的连线因此保持惰性；某条线第一次被点击时两个标志一起打开
   *（之后再点幂等），于是用户仍能像以前一样删除 / 重连它，
   * 而整张图不会为没人碰的连线白白付交互开销。 */
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (edge.deletable === true && edge.reconnectable === true) {
        return;
      }
      setEdges((eds) =>
        eds.map((e) => (e.id === edge.id ? { ...e, deletable: true, reconnectable: true } : e)),
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
     * 工作流自带的原始布局。 */
    reloadView: () => {
      forceReloadDetail(viewHostNodeId, true);
    },
    /* 子图视图下把宿主链路传进去：内部节点 id 要拼成 `宿主:内部` 才与
     *  `positions` 列里的键同口径（见 use-workflow-persistence 的说明）。 */
    hostNodeId: viewHostNodeId,
  });

  /* IO 预览面板的「模式集合变更」落库（编排细节见 use-io-modes-commit）。 */
  const handleModesChange = useIoModesCommit({
    ioApi,
    detail,
    setDetail,
    savePatch,
    workflowId,
  });

  /* Loading state */
  if (loading) {
    return <WorkflowEditorLoadingScreen />;
  }

  if (error || !detail) {
    return <WorkflowEditorErrorScreen error={error} onClose={onClose} />;
  }

  return (
    <FullScreenLayer className="bg-canvas flex flex-col pb-6" zClass={zClass("modal")}>
      {/* ── Top bar ── */}
      <WorkflowEditorTopBar
        detail={detail}
        error={error}
        fetchDetail={fetchDetail}
        forceReloadDetail={forceReloadDetail}
        handleSave={handleSave}
        onClose={onClose}
        onExitSubgraph={onExitSubgraph}
        resetLayout={resetLayout}
        rootWorkflowName={rootWorkflowName}
        saving={saving}
        setSubgraphStack={setSubgraphStack}
        setViewJsonOpen={setViewJsonOpen}
        subgraphStack={subgraphStack}
        viewHostNodeId={viewHostNodeId}
      />

      {/* ── Canvas ── */}
      <div className="relative min-h-0 flex-1">
        {subgraphLoading && <SubgraphLoadingOverlay />}
        {ioEditMode && <IoEditModeBanner />}
        {subgraphError && (
          <SubgraphErrorToast
            error={subgraphError}
            onDismiss={() => {
              setSubgraphError("");
            }}
          />
        )}
        {/* IO 预览侧栏：与 CreatePanel / 画布节点消费同一个 DynamicWorkflowForm，
            数据来自**实时**的 `workflowIO`，勾一个复选框立刻看到新行。本地状态只有
            toggleIO 写的身份字段（无 type/defaultValue/nodeTitle/multiline），必须叠加
            `detail.workflowIO[key]` 的服务端富化，否则新勾的针脚退化成只读 `link`；
            再叠本地 `label` 让未保存的重命名立即生效。 */}
        {ioPreviewOpen && (
          <WorkflowIoPreviewPanel
            defaultMode={detail.defaultMode ?? null}
            detailIOMap={ioDetailMap}
            modes={detail.availableModes ?? []}
            onClose={() => {
              setIoPreviewOpen(false);
            }}
            onModesChange={handleModesChange}
            workflowIO={workflowIO}
          />
        )}
        <WorkflowEditorCanvas
          canvasSettings={canvasSettings}
          canvasSettingsHydrated={canvasSettingsHydrated}
          edges={edges}
          nodes={nodes}
          onEdgeClick={onEdgeClick}
          onEdgesChange={onEdgesChange}
          onMiniMapJump={onMiniMapJump}
          onNodeDragStop={onNodeDragStop}
          onNodesChange={onNodesChange}
          onOpenSettings={() => {
            setCanvasSettingsOpen(true);
          }}
          onRecenter={recenterCanvas}
          /* 选中节点后由画布把「相关连线」与「相关端口行」标记分别写回 edges /
           * 节点 data（连线加粗提亮，落到的端口行同步提亮）。 */
          setEdges={setEdges}
          setNodes={setNodes}
        />
        <CanvasHintTooltip />
        {/* 右边缘画布设置抽屉。面板自己把内容 portal 到
         *  document.body，好让它压在
         *  WorkflowCanvasEditor 根遮罩栈（`modal` 档）之上；只在
         *  点击齿轮按钮时渲染。 */}
        {canvasSettingsOpen && (
          <CanvasSettingsPanel
            onClose={() => {
              setCanvasSettingsOpen(false);
            }}
            reset={resetCanvasSettings}
            settings={canvasSettings}
            update={updateCanvasSetting}
          />
        )}
        {/* 工作流编辑画布是纯配置界面（不存在执行），不再挂执行日志入口；
         *  执行期的日志仍由项目画布的 GlobalStepLogPanel 承担。 */}
        {/* 顶部「📋 查看 JSON」触发的全屏 modal：派生数据由 `sourceModalData` 给出 ——
            顶层 detail 用 detail 的 graph/rawJson；sub 视图用 sub-detail 的 graph，
            rawJson 切自父级 `definitions.subgraphs[uid]`。关闭即清空 viewJsonOpen。 */}
        {viewJsonOpen && sourceModalData && (
          <SourceModal
            data={sourceModalData}
            onClose={() => {
              setViewJsonOpen(false);
            }}
          />
        )}
      </div>
    </FullScreenLayer>
  );
}
