"use client";

/* ── 主编点组件 ──
 * 行为不变地拆成 hook。逻辑簇现在住在本目录的兄弟模块里：
 * use-file-upload.ts（上传管线）、
 * use-workflow-io.ts（共享列表 + 动态 IO 表 + 播种/筛选 effect）、
 * use-generate.ts（对账 + runGenerate + 错误面板重试）与
 * ErrorPanel.tsx（可折叠错误面板）。本文件保留状态组装、
 * patch 与「按 kind 渲染 body」的 JSX。 */
import React, { useCallback } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { WorkflowNode } from "../WorkflowNode";
import { ContentAssetBody } from "../ContentAssetNode";
import { ImageGenerationPanel } from "../ImageGenerationPanel";
import {
  type CanvasNodeData,
  type CanvasNodeType,
  NODE_META,
} from "~/lib/project-canvas/canvas-types";
import { Hint } from "~/components/ui/hint";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { useWorkflowModes } from "./hooks/use-workflow-modes";
import { DebugChainFooter } from "../../debug/DebugChainFooter";
import { getProjectCanvasRenderChain } from "../canvas-render-chain";
import {
  NodeChip,
  PORT_STYLE,
  StatusBadge,
  StatusDot,
} from "./CanvasNodePrimitives";
import { OutputRowPort, SelectedToolbar } from "./SelectedToolbar";
import { useFileUpload } from "./hooks/use-file-upload";
import { useWorkflowIo } from "./hooks/use-workflow-io";
import { useGenerate } from "./hooks/use-generate";
import { useShotGenerationWriteback } from "./hooks/use-shot-generation-writeback";
import { requestShotRedo } from "~/lib/production/shot-writeback";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { ErrorPanel } from "./ErrorPanel";
import { resolveWorkflowMode } from "~/lib/workflow/workflow-types";

export const CanvasNode = React.memo(function CanvasNode({
  id,
  data,
  selected,
}: NodeProps<CanvasNodeType>) {
  const d = data as CanvasNodeData;
  const { setNodes, getNode, setEdges, fitView, screenToFlowPosition } =
    useReactFlow();
  const meta = NODE_META[d.kind];

  /* 镜头节点生成落定 → 回写对应 Shot（Phase 3c-2b，见 hook 注释）。 */
  useShotGenerationWriteback(d);

  const patch = useCallback(
    (p: Partial<CanvasNodeData>) =>
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? { ...node, data: { ...(node.data as CanvasNodeData), ...p } }
            : node,
        ),
      ),
    [id, setNodes],
  );
  const deleteSelf = () => setNodes((nds) => nds.filter((nd) => nd.id !== id));

  /* 镜头节点「退回让 AI 重做」：本地先回落 idle（清结果），并写回统一项目（清 imageUrl/clipUrl
   * + rev 自增）；run 若在跑，规划器下一步会重做该镜。IO 走 lib 客户端，本视图不碰 fetch。 */
  const redoShot = useCallback(() => {
    if (!d.shotId) return;
    patch({ status: "idle", resultPath: undefined, error: undefined });
    void requestShotRedo(getActiveId() ?? "", d.shotId);
  }, [d.shotId, patch]);

  const focusNode = () =>
    fitView({ nodes: [{ id }], duration: 300, padding: 0.2, maxZoom: 1.2 });

  /* 文件上传管线：生成器图片输入、内容载体媒体选择器与
   * 拖放用的选取 / 上传处理器。隐藏 input 由管线自己持有并渲染
   * （`ImageInput` /`MediaInput`）。 */
  const { ImageInput, pickFile, MediaInput, pickMedia, onUploadFile } =
    useFileUpload({ patch });

  /* 共享工作流列表 + 动态 IO 表 + 模式 / 来源筛选 + 播种。 */
  const {
    wfList,
    wfListLoading,
    modelTagLib,
    modelFilter,
    setModelFilter,
    wfIO,
    wfIOLoading,
    wfParamMap,
    wfModes,
    setWfModes,
    sourceFilter,
    setSourceFilter,
    seededFor,
  } = useWorkflowIo({ d, patch });

  /* 多模式保存：乐观更新 + 失败回滚都在这个 hook 里（视图零 IO）。 */
  const { saveModes } = useWorkflowModes({
    workflowId: d.workflowId,
    modes: wfModes,
    setModes: setWfModes,
    onFailed: (reason) => patch({ error: reason, status: "error" }),
  });

  /* 任务运行逻辑：挂载时对账 + runGenerate + 错误面板重试。 */
  /* 运行期与编辑器取同一个生效模式：`defaultMode → modes[0] → taskType`。
   * 运行期表单按这个模式解析默认值与落点，落库的键也是`source.mode:<模式>`。 */
  const wfMode = resolveWorkflowMode({
    modes: wfModes?.modes,
    defaultMode: wfModes?.defaultMode,
    taskType: d.workflowTaskType ?? null,
  });

  const { runGenerate, retryGenerate } = useGenerate({
    id,
    d,
    patch,
    wfIO,
    wfParamMap,
    wfMode,
    setNodes,
    setEdges,
    getNode,
    screenToFlowPosition,
  });

  /* ── 按 kind 渲染 body ── */
  let body: React.ReactNode = null;

  if (d.kind === "image" || d.kind === "video") {
    /* 生图/生成视频节点本体即生成器 —— 复用
     * ImageGenerationPanel（与 picture 节点同源），渲染「类型→模型→工作流」
     * 三步级联 + 参数表单 + 生成 CTA。 */
    body = (
      <ImageGenerationPanel
        kind={d.kind}
        d={d}
        patch={patch}
        wfList={wfList}
        modelTagLib={modelTagLib}
        wfIO={wfIO}
        wfIOLoading={wfIOLoading}
        wfListLoading={wfListLoading}
        seededFor={seededFor}
        setWfModes={setWfModes}
        onGenerate={runGenerate}
        onReplaceResult={() => pickFile("inputImage")}
      />
    );
  } else if (d.kind === "text" || d.kind === "movie") {
    /* ── 内容载体节点（text / movie）· 对齐 Ardot 稿 715394877779066 v2 ──
     * 边框内 ~100% 预览（视频填满、文本 textarea 填满），空状态居中类型图标 + helper；
     * 右下 36×36 圆 FAB（类型色 #FF5CA8 粉 / #FB923C 橙 + 白色图标）触发编辑/上传。
     * Handle 全部在本组件渲染：右侧 output（同 parent 50%）。内容区与 FAB 抽离到
     * ContentAssetBody 便于复用与单测。输出 Handle
     * 直接骑跨在右侧边框 50% 处。 */
    const outStyle =
      d.kind === "text" ? PORT_STYLE.condition : PORT_STYLE.image;
    body = (
      <div className="relative -mx-3.5">
        {/* 右侧 source Handle — 与 picture 左输入 Handle 同 parent
         * 同 top:50%，自然共 Y；对 text 用 condition（橙）/ movie 用 image（绿）。*/}
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          style={{
            position: "absolute",
            right: -5,
            top: "50%",
            transform: "translateY(-50%)",
            width: 10,
            height: 10,
            background: outStyle.gradient,
            border: `1.5px solid ${outStyle.color}`,
            boxShadow: `0 0 10px ${outStyle.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
            borderRadius: 9999,
          }}
        />
        <ContentAssetBody
          kind={d.kind}
          data={d}
          onPatch={patch}
          onPickMedia={pickMedia}
          onUploadFile={onUploadFile}
          status={d.status}
          progress={d.progress}
        />
      </div>
    );
  } else if (d.kind === "picture") {
    /* 图片资产 = 生图节点整体。
     * 主体永远显示预览（ContentAssetBody，含左侧 inputImage + 右侧 output Handle + FAB）；
     * 仅当选中该节点时，在预览下方展开 ImageGenerationPanel（类型→模型→工作流 + 参数 +
     * 生成 CTA）—— 即生图节点的「下半部分（除标题外）」。取消选中后下半部分隐藏，但已
     * 填写的 workflowId / workflowInputs / genModelTag 仍存于 d（patch 落库），重选即恢复，
     * 信息不丢。生成成功的图片直接写回本节点 mediaPath，由 ContentAssetBody 预览展示。 */
    const outStyle = PORT_STYLE.image;
    body = (
      <div className="flex flex-col gap-2">
        <div className="relative -mx-3.5">
          {/* 左侧 IMAGE input Handle — 上游工作流 outputs 连入自动接收生成图，
           * 也可作为本节点生成时的参考/底图（runGenerate 透传 d.inputImage）。 */}
          <Handle
            type="target"
            position={Position.Left}
            id="inputImage"
            style={{
              position: "absolute",
              left: -5,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              background: PORT_STYLE.image.gradient,
              border: `1.5px solid ${PORT_STYLE.image.color}`,
              boxShadow: `0 0 10px ${PORT_STYLE.image.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
              borderRadius: 9999,
            }}
          />
          {/* 右侧 source Handle：生成结果（或上传图）作为下游 inputImage 源。*/}
          <Handle
            type="source"
            position={Position.Right}
            id="output"
            style={{
              position: "absolute",
              right: -5,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              background: outStyle.gradient,
              border: `1.5px solid ${outStyle.color}`,
              boxShadow: `0 0 10px ${outStyle.glow}, 0 0 0 1px rgba(255,255,255,0.08)`,
              borderRadius: 9999,
            }}
          />
          <ContentAssetBody
            kind="picture"
            data={d}
            onPatch={patch}
            onPickMedia={pickMedia}
            onUploadFile={onUploadFile}
            status={d.status}
            progress={d.progress}
          />
        </div>
        {selected && (
          <div className="border-border-strong border-t pt-2">
            <ImageGenerationPanel
              kind="picture"
              d={d}
              patch={patch}
              wfList={wfList}
              modelTagLib={modelTagLib}
              wfIO={wfIO}
              wfIOLoading={wfIOLoading}
              wfListLoading={wfListLoading}
              seededFor={seededFor}
              setWfModes={setWfModes}
              onGenerate={runGenerate}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    /* 选中态边框 — Card 在 selected 时加 2px 紫色
 outline + 4px offset + 紫光晕投影；非选中态保持 1px border + 低调黑
 投影。transition 150ms 让用户拖动选区时视觉平滑，border 自身不变
 （避免 1px ↔ 2px 跳。Handle 骑跨设计保留——右下紫色 Handle 圆点本
 就设计在外露 +6，与 outline-offset 4 不冲突）。*/
    <div
      /* 节点卡宽度从 340 提到 380，好让
       * 标签列（「宽度」/「高度」/「步数」…）能完整渲染 2 字
       * CJK 标签而不与步进器抢空间。配合
       * （步进器以 max-w-[180px] 封顶），布局
       * 现为： [label flex-1] ……… [type chip] / [stepper ≤180]，作用于
       * 每条工作流 widget 行。 */
      className="border-border-strong bg-card relative w-95 rounded-[14px] border transition-[outline,box-shadow] duration-150"
      style={
        selected
          ? {
              outline: "2px solid #7C5CFC",
              outlineOffset: "4px",
              boxShadow:
                "0 0 0 1px rgba(124,92,252,0.50), 0 4px 24px rgba(124,92,252,0.30)",
            }
          : {
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            }
      }
    >
      {selected && (
        <SelectedToolbar
          onDelete={deleteSelf}
          onFocusNode={focusNode}
          onRedo={d.shotId ? redoShot : undefined}
        />
      )}
      {/* 头部按节点类型分支：自定义工作流走 Ardot 稿 v2 精确 token
       * （紫色 W 圆角方块 + 标题 + 状态胶囊）；其它节点保留通用 NodeChip。
       * 外壳严格对齐 9:27/9:61：radius12、无投影、padding20；表单区包一层
       * 暗色面板 #0B0B10/radius10/border #26262E/padding14，与头部间距 14。 */}
      {d.kind === "workflow" ? (
        <WorkflowNode
          id={id}
          data={d}
          workflowIO={wfIO}
          workflowIOLoading={wfIOLoading}
          workflowListLoading={wfListLoading}
          workflowList={wfList}
          workflowModes={wfModes}
          sourceFilter={sourceFilter}
          modelTagLib={modelTagLib}
          modelFilter={modelFilter}
          onPatch={patch}
          onSourceFilterChange={setSourceFilter}
          onModelFilterChange={setModelFilter}
          onGenerate={runGenerate}
          onSelectWorkflow={(workflowId) => {
            const wf = wfList.find((item) => item.id === workflowId);
            seededFor.current = null;
            patch({
              workflowId: workflowId || undefined,
              workflowName: wf?.name,
              workflowTaskType: wf?.taskType,
              workflowInputs: {},
              paramMap: undefined,
              workflowSinkId: undefined,
            });
          }}
          onFormChange={(next) => patch({ workflowInputs: next })}
          onSeedModeChange={(ioKey, mode) =>
            patch({ seedModes: { ...(d.seedModes ?? {}), [ioKey]: mode } })
          }
          onModesChange={(modes, defaultMode) =>
            saveModes({ modes, defaultMode })
          }
        />
      ) : (
        <>
          {(() => {
            /* 资产节点（text/picture/movie）
             * 是「内容载体」，不参与运行态，状态徽标/关闭按钮与画布语义无关 →
             * 头部只留 NodeChip。无障碍与误删保护由 SelectedToolbar 的
             * ⌫ 按钮统一承担。*/
            const isAsset =
              d.kind === "text" || d.kind === "picture" || d.kind === "movie";
            return (
              <div className="border-border-strong flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
                <NodeChip kind={d.kind} name={meta.label} />
                {!isAsset && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <StatusDot status={d.status} />
                    <StatusBadge status={d.status} />
                    <Hint label="删除节点" accessibleName>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={deleteSelf}
                        className="text-ink-muted hover:text-destructive ml-1 h-auto p-0 hover:bg-transparent"
                      >
                        <Icon data-icon="inline-start" name="close" size={14} />
                      </Button>
                    </Hint>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="px-3.5 py-2.5">{body}</div>
        </>
      )}
      {/* 可折叠错误面板 —— 状态 / 推导 / JSX 都在 ErrorPanel；
       * 节点没有可见错误时它自己渲染 null。 */}
      <ErrorPanel
        nodeId={id}
        kind={d.kind}
        status={d.status}
        error={d.error}
        errorStatus={d.errorStatus}
        errorContext={d.errorContext}
        validationErrors={d.validationErrors}
        taskId={d.taskId}
        workflowId={d.workflowId}
        workflowName={d.workflowName}
        onRetry={retryGenerate}
      />
      <ImageInput />
      {/* 内容载体上传输入 —— 同时接受图片与视频 */}
      <MediaInput />
      {/* 主输出端口 + 类型标签 — 改为与 WorkflowNode.outputs
       * row 同款结构（label + typeChip + PortHandle）。image / video / script 通用。 */}
      {(d.kind === "image" || d.kind === "video" || d.kind === "script") && (
        <div className="border-border-strong border-t">
          <OutputRowPort kind={d.kind} wfIO={wfIO ?? null} />
        </div>
      )}
      {/* 工作流输出 —— 由 ComfyUI 工作流暴露成右侧可连接的
       * 源句柄（沿用标准工作流画布端点样式，
       * 没有单独的底栏行）。颜色按解析出的输出类型
       * （IMAGE/VHS_VIDEO…）经 outputTargetKind 走，所以句柄始终与
       * Ardot 设计 token 一致，无论所选工作流的任务类型是什么。
       *
       * 用户反馈画布 workflow 节点右侧的紫色圆点
       * 「看起来像漏出的 bug」—— workflow 节点是叶节点（生成图片 / 视频），
       * 在 project canvas 上不会接出到下游节点，所以这个 source Handle 实
       * 际上没人连。需要让出端口的能力由画布 IO-edit modal 提供（不在节
       * 点上外挂圆点）。直接干掉这个 Handle，只在节点外侧浮层工具栏
       * 「添加输出」里有需要时显式拖出。 */}
      {/* 已移除：d.kind ==="workflow" && <Handle type="source" ... /> */}
      {/* 内容载体的输出句柄（text / picture / movie）——
 已上移到 body wrapper 内（与 picture input Handle 同 parent），
 保持右侧 50% 与左侧同 Y；底部不再挂 footer 行，去掉「输出 · 图像」label 与装饰点。
 video 节点现在也走 OutputRowPort（同 image / script）
 * —— 与 WorkflowNode.outputs row 视觉对齐。agent / text / picture / movie 仍由各自
 * body 内的 Handle 处理。 */}
      {/* agent：没有输出 Handle */}
      {/* 调试模式：渲染链路模块标签（仅 debug-store 开启时由
       * DebugChainFooter 自行显示，kind 决定链路）。 */}
      <DebugChainFooter modules={getProjectCanvasRenderChain(d.kind)} />
    </div>
  );
});
