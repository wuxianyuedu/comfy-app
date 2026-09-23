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
import { useWorkshopAgent } from "~/components/workshop/hooks/use-workshop-agent";
import { ModeContractDialog } from "~/components/workshop/mode-contract/ModeContractDialog";
import { WorkshopModelAdapterModal } from "~/components/workshop/WorkshopModelAdapterModal";
import { LLMProvider } from "~/components/workshop/LLMContext";
import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { WorkshopAside } from "~/components/workshop/WorkshopAside";
import { WorkshopHeader } from "~/components/workshop/WorkshopHeader";
import { WorkshopStageBody } from "~/components/workshop/WorkshopStageBody";
import { WorkshopStageNav } from "~/components/workshop/WorkshopStageNav";
import type { WorkshopAgentToolHandlers } from "~/components/workshop/hooks/use-workshop-agent";
import { renderProjectFilm } from "~/lib/film/render-film-client";
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { RunControlBar } from "~/components/agent-run/RunControlBar";

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

  return (
    <LLMProvider>
      <div className="bg-bg text-ink min-h-screen w-full pb-6">
        <WorkshopHeader
          title={controller.meta.title}
          progressPct={controller.progressPct}
          pendingCategories={controller.pendingCategories}
          apiChannels={controller.apiChannels}
          onOpenApiSettings={controller.openApiSettings}
          onOpenModeContract={controller.openModeContract}
        />

        <RunControlBar />

        <WorkshopStageNav
          tab={controller.tab}
          stageRatios={controller.stageRatios}
          viewContext={controller.viewContext}
          onTabChange={controller.setTab}
        />

        <div className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-[1fr_308px]">
          <WorkshopStageBody controller={controller} />
          <WorkshopAside
            missing={controller.missing}
            workflowOptions={controller.workflowOptions}
            workflowId={controller.workflowId}
            onWorkflowChange={controller.setWorkflowId}
            videoWorkflowId={controller.videoWorkflowId}
            onVideoWorkflowChange={controller.setVideoWorkflowId}
            apiChannels={controller.apiChannels}
            onOpenApiSettings={controller.openApiSettings}
            characterCount={controller.characters.length}
            imageDoneCount={controller.imageDoneCount}
            clipDoneCount={controller.clipDoneCount}
            onGoScript={() => controller.setTab("script")}
          />
        </div>

        {/* 模型适配：为远端模型配置工坊各模式下的输入 / 输出映射 */}
        {controller.apiSettingsOpen && (
          <WorkshopModelAdapterModal onClose={controller.closeApiSettings} />
        )}

        {/* 模式契约：每种模式对外有哪些统一输入 / 输出（独立入口、独立界面） */}
        {controller.modeContractOpen && (
          <ModeContractDialog onClose={controller.closeModeContract} />
        )}
      </div>

      {/* Agent 指挥助手浮层 */}
      {!agentController.open && <AgentFab onOpen={agentController.openAgent} />}
      <AgentOverlay controller={agentController} />
    </LLMProvider>
  );
}
