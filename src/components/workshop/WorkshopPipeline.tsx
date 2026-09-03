"use client";

// 工坊管线 —— 薄容器。
//
// 分层（见 docs/standards/16-shadcn-ui与表单校验.md §16.2「工具建界面，前端只写逻辑」）：
//   • hooks/use-workshop-pipeline.ts  全部业务逻辑（状态/持久化/拉取/生图/派生进度）
//   • stage-config.ts                 阶段常量与派生展示数据（纯函数，无 React）
//   • Workshop{Header,StageNav,StageBody,Aside}.tsx  纯展示，只消费 controller
//   • ui/                             shadcn 原语，归工具生成，业务侧不手改
// 本文件只做：取 controller → 组合视图 → 挂载弹层。

import { ApiChannelSettings } from "~/components/workshop/ApiChannelSettings";
import { LLMProvider } from "~/components/workshop/LLMContext";
import { useWorkshopPipeline } from "~/components/workshop/hooks/use-workshop-pipeline";
import { WorkshopAside } from "~/components/workshop/WorkshopAside";
import { WorkshopHeader } from "~/components/workshop/WorkshopHeader";
import { WorkshopStageBody } from "~/components/workshop/WorkshopStageBody";
import { WorkshopStageNav } from "~/components/workshop/WorkshopStageNav";

export function WorkshopPipeline() {
  const controller = useWorkshopPipeline();

  return (
    <LLMProvider>
      <div className="dark bg-bg text-ink min-h-screen w-full">
        <WorkshopHeader
          title={controller.meta.title}
          progressPct={controller.progressPct}
          pendingCategories={controller.pendingCategories}
          apiChannels={controller.apiChannels}
          onOpenApiSettings={controller.openApiSettings}
          projects={controller.projects}
          activeProjectId={controller.activeProjectId}
          onSwitchProject={controller.switchProject}
          onCreateProject={controller.createProject}
          onRenameProject={controller.renameProject}
          onDeleteProject={controller.deleteProject}
        />

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
            checkpoints={controller.checkpoints}
            checkpoint={controller.checkpoint}
            onCheckpointChange={controller.setCheckpoint}
            apiChannels={controller.apiChannels}
            onOpenApiSettings={controller.openApiSettings}
            characterCount={controller.characters.length}
            imageDoneCount={controller.imageDoneCount}
            clipDoneCount={controller.clipDoneCount}
            onGoScript={() => controller.setTab("script")}
          />
        </div>

        {/* API 直连通道设置(生图 / 视频)— 与 LLM 设置同款交互模型 */}
        {controller.apiSettingsOpen && (
          <ApiChannelSettings
            initial={controller.apiChannels}
            onClose={controller.closeApiSettings}
            onSaved={controller.handleApiChannelsSaved}
          />
        )}
      </div>
    </LLMProvider>
  );
}
