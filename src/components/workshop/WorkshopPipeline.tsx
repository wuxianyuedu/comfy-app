"use client";

// 工坊管线 —— 薄容器。
//
// 分层（见 docs/standards/16-shadcn-ui与表单校验.md §16.2「工具建界面，前端只写逻辑」）：
//   • hooks/use-workshop-pipeline.ts  全部业务逻辑（状态/持久化/拉取/生图/派生进度）
//   • stage-config.ts                 阶段常量与派生展示数据（纯函数，无 React）
//   • Workshop{Header,StageNav,StageBody,Aside}.tsx  纯展示，只消费 controller
//   • ui/                             shadcn 原语，归工具生成，业务侧不手改
// 本文件只做：取 controller → 组合视图 → 挂载弹层。

import { AgentFab, AgentOverlay } from "~/components/workshop/AgentOverlay";
import { WorkspaceFrame } from "~/components/studio/ViewContainer";
import { useDraggablePosition } from "~/components/ui/use-draggable-position";
import { useWorkshopAgent } from "~/components/workshop/hooks/use-workshop-agent";
import { WorkshopModelAdapterModal } from "~/components/workshop/WorkshopModelAdapterModal";
import { LLMProvider } from "~/components/workshop/LLMContext";
import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { WorkshopAside } from "~/components/workshop/WorkshopAside";
import { WorkshopHeader } from "~/components/workshop/WorkshopHeader";
import { WorkshopStageBody } from "~/components/workshop/WorkshopStageBody";
import { WorkshopStageRail } from "~/components/workshop/WorkshopStageRail";
import type { WorkshopAgentToolHandlers } from "~/components/workshop/hooks/use-workshop-agent";
import { renderProjectFilm } from "~/lib/film/render-film-client";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { RunControlBar } from "~/components/agent-run/RunControlBar";

/** Agent 入口位置的存储键与默认落点（右下角、让开底部状态栏）。
 *
 * 这两个常量提到组件外：它们是 `useDraggablePosition` 的 effect 依赖，
 * 在渲染里新造对象会让量位置的 effect 每帧重跑。 */
const AGENT_FAB_POSITION_KEY = "comfyapp:agent-fab-position:v1";
const AGENT_FAB_DEFAULT_OFFSET = { right: 24, bottom: 40 };

export function WorkshopPipeline() {
  const controller = useWorkshopPipeline();

  // Agent 指挥助手：把 controller 的数据读写能力注入给 Agent hook。
  const agentHandlers: WorkshopAgentToolHandlers = {
    getDraft: () => ({
      meta: controller.meta,
      scriptMarkdown: controller.scriptMarkdown,
      scenes: controller.scenes,
      characters: controller.characters,
      shots: controller.shots,
    }),
    getMeta: () => controller.meta,
    setMeta: (patch) => controller.setMeta((prev) => ({ ...prev, ...patch })),
    setScriptMarkdown: (markdown) => controller.setScriptMarkdown(markdown),
    getScriptMarkdown: () => controller.scriptMarkdown,
    getCharacters: () => controller.characters,
    setCharacters: (characters) => controller.setCharacters(characters),
    getShots: () => controller.shots,
    setShots: (shots) => controller.setShots(shots),
    // Phase 5：Agent 用当前项目镜头一键成片（走服务端成片管线，含逐镜视频 + 合成 + 回写）。
    renderFilm: () =>
      renderProjectFilm({
        projectId: getActiveId(),
        videoWorkflowId: controller.videoWorkflowId || undefined,
        imageWorkflowId: controller.workflowId || undefined,
      }),
  };
  const agentController = useWorkshopAgent(agentHandlers);

  /* Agent 入口的位置：可拖动 + 跨会话记住（`ui/use-draggable-position`）。
   * 浮层展开后跟着同一份偏移走，所以位置只在 hook 里存一次 —— 常量对象
   * 提出来，避免每次渲染新造一个把它变成 effect 的依赖。 */
  const agentFab = useDraggablePosition<HTMLButtonElement>({
    storageKey: AGENT_FAB_POSITION_KEY,
    defaultOffset: AGENT_FAB_DEFAULT_OFFSET,
    onClick: agentController.openAgent,
  });

  return (
    <LLMProvider>
      <WorkspaceFrame className="bg-bg text-ink">
        {/* 整屏**一条**纵向滚动条收在这里。原先根上是 `min-h-screen`（在壳里等于
            又开一个视口高），调用点再包一层 `h-full overflow-y-auto` —— 两条滚动条
            叠着，内容一高就各滚各的。外框吃满父级、这一层自己滚，滚动条只剩一条。 */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <WorkshopHeader
            title={controller.meta.title}
            progressPct={controller.progressPct}
            health={controller.health}
          />

          <RunControlBar />

          {/* 三列：阶段轨道（固定列，不随内容挤压）+ 内容 + 右侧检查/素材。
            轨道原先是 grid 之上的一条全宽横条；现在它进网格作第一列，
            宽度取 --spacing-stage-rail 一档，不在此处重复写字面量。 */}
          <div className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-[var(--spacing-stage-rail)_1fr_308px]">
            <WorkshopStageRail
              tab={controller.tab}
              stageRatios={controller.stageRatios}
              viewContext={controller.viewContext}
              onTabChange={controller.setTab}
            />
            <WorkshopStageBody controller={controller} />
            <WorkshopAside
              missing={controller.missing}
              workflowOptions={controller.workflowOptions}
              workflowId={controller.workflowId}
              onWorkflowChange={controller.setWorkflowId}
              videoWorkflowId={controller.videoWorkflowId}
              onVideoWorkflowChange={controller.setVideoWorkflowId}
              apiChannels={controller.apiChannels}
              characterCount={controller.characters.length}
              imageDoneCount={controller.imageDoneCount}
              clipDoneCount={controller.clipDoneCount}
              onGoScript={() => controller.setTab("script")}
            />
          </div>

          {/* 模型适配的**上下文入口**（「API 直连未配置 → 去配置」）：整幅入口在侧栏
            （与项目无关），这里只服务阶段内那句就近提示。 */}
          {controller.apiSettingsOpen && (
            <WorkshopModelAdapterModal onClose={controller.closeApiSettings} />
          )}
        </div>
      </WorkspaceFrame>

      {/* Agent 指挥助手：入口与浮层共用同一份位置偏移（拖到哪、浮层就从哪展开）。
          浮层打开时不再渲染入口 —— 入口那一枚图标的位置由浮层自己接着表达。 */}
      {!agentController.open && (
        <AgentFab
          elementRef={agentFab.elementCallbackRef}
          onOpen={agentController.openAgent}
          offset={agentFab.offset}
          dragging={agentFab.dragging}
          handleProps={agentFab.handleProps}
        />
      )}
      <AgentOverlay
        controller={agentController}
        anchor={agentFab.offset ?? AGENT_FAB_DEFAULT_OFFSET}
      />
    </LLMProvider>
  );
}
