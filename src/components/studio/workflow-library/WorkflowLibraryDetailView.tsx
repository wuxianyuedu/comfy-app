"use client";

// WorkflowLibraryDetail 的纯展示视图：只消费 controller，不发请求、不算业务
// 规则，交互一律通过 controller.actions 上抛。

import { ExternalLink } from "lucide-react";

import { SourceModal } from "~/components/studio/SourceModal";
import type { WorkflowLibraryDetailController } from "./hooks/use-workflow-library-detail";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { DETAIL_TABS, type DetailTab } from "./workflow-library-detail-config";
import { DetailBody } from "./sections/DetailBody";
import { DetailHeader } from "./sections/DetailHeader";

export function WorkflowLibraryDetailView({
  controller,
}: {
  controller: WorkflowLibraryDetailController;
}) {
  const {
    workflow,
    metaEditor,
    activeTab,
    setActiveTab,
    activeMode,
    setActiveMode,
    sourceOpen,
    openSource,
    closeSource,
    isLoading,
    errorMessage,
    workflowIO,
    paramMap,
    sourceData,
    usable,
    canResync,
    missing,
    isTechnical,
    busyDownload,
    busyResync,
    actions,
  } = controller;

  if (!workflow) {
    return (
      <div className="text-ink-fainter flex h-full flex-col items-center justify-center">
        <div className="border-border bg-subtle mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border">
          <ExternalLink className="h-7 w-7 opacity-40" />
        </div>
        <p className="text-sm">在左侧选择一个工作流查看详情</p>
      </div>
    );
  }

  return (
    <div className="bg-panel-deep flex h-full flex-col overflow-hidden">
      <DetailHeader
        workflow={workflow}
        usable={usable}
        canResync={canResync}
        missing={missing}
        isTechnical={isTechnical}
        busyDownload={busyDownload}
        busyResync={busyResync}
        onEdit={actions.edit}
        onResync={actions.resync}
        onDownload={actions.download}
        onDelete={actions.remove}
        onOpenSource={openSource}
        onUse={actions.use}
        meta={metaEditor}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DetailTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList
          variant="line"
          className="border-border-subtle h-auto w-full justify-start gap-1 rounded-none border-b px-4"
        >
          {DETAIL_TABS.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="detail-tab-trigger h-auto flex-none rounded-none px-3 py-2.5 text-[12px] font-medium"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* 「编辑对外参数 / 实际使用」两个页签共用**同一个常驻实例**：
            预览的表单与运行态在两个视图间是同一份（DynamicWorkflowForm 完全
            相同），放进 TabsContent 会随切换卸载重建、用户填了一半的参数被
            重置。这里用受控 hidden 容器承载（不参与 Panel 卸载机制），
            切页签只改 `viewMode`。 */}
        <div
          hidden={activeTab !== "canvas" && activeTab !== "use"}
          className="min-h-0 flex-1 overflow-y-auto p-5"
        >
          <DetailBody
            workflow={workflow}
            tab={activeTab === "use" ? "use" : "canvas"}
            isLoading={isLoading}
            workflowIO={workflowIO}
            paramMap={paramMap}
            sourceData={sourceData}
            usable={usable}
            onEdit={actions.edit}
            activeMode={activeMode}
            onActiveModeChange={setActiveMode}
            meta={{
              modes: metaEditor.modes,
              defaultMode: metaEditor.defaultMode,
              /* 画布卡片上的模式下拉**同时**改当前模式与默认模式（既有口径：
               *  在这一排选模式 = 选默认模式，落库）。封装页签的切换器只改当前
               *  模式（见其自身说明）。 */
              onModeChange: (code) => {
                setActiveMode(code);
                void metaEditor.patchModes(metaEditor.modes, code);
              },
            }}
            onSeedModeChange={(ioKey, mode) => {
              void metaEditor.patchSeedMode(ioKey, mode);
            }}
            onPatchParamMap={(next) => metaEditor.patchParamMap(next)}
          />
        </div>

        {(["params", "source"] as const).map((tab) => (
          <TabsContent
            key={tab}
            value={tab}
            className="min-h-0 flex-1 overflow-y-auto p-5"
          >
            <DetailBody
              workflow={workflow}
              tab={tab}
              isLoading={isLoading}
              workflowIO={workflowIO}
              paramMap={paramMap}
              sourceData={sourceData}
              usable={usable}
              onEdit={actions.edit}
              activeMode={activeMode}
              onActiveModeChange={setActiveMode}
              meta={{
                modes: metaEditor.modes,
                defaultMode: metaEditor.defaultMode,
                onModeChange: (code) => {
                  setActiveMode(code);
                  void metaEditor.patchModes(metaEditor.modes, code);
                },
              }}
              onSeedModeChange={(ioKey, mode) => {
                void metaEditor.patchSeedMode(ioKey, mode);
              }}
              onPatchParamMap={(next) => metaEditor.patchParamMap(next)}
            />
          </TabsContent>
        ))}
      </Tabs>

      {sourceOpen && (
        <SourceModal
          data={sourceData}
          loading={isLoading}
          error={errorMessage}
          onClose={closeSource}
        />
      )}
    </div>
  );
}
