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

/** Tabs 的值来自 `DETAIL_TABS` 的 key；集合外的值忽略。 */
function isDetailTab(value: unknown): value is DetailTab {
  return typeof value === "string" && DETAIL_TABS.some((tab) => tab.key === value);
}

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
    canvasMounted,
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
        <div className="border-border bg-subtle mb-3 flex size-16 items-center justify-center rounded-2xl border">
          <ExternalLink className="size-7 opacity-40" />
        </div>
        <p className="text-sm">在左侧选择一个工作流查看详情</p>
      </div>
    );
  }

  return (
    /* SAFETY: 类型断言已复核 */
    <div className="bg-panel-deep flex h-full flex-col overflow-hidden">
      <DetailHeader
        busyDownload={busyDownload}
        busyResync={busyResync}
        canResync={canResync}
        isTechnical={isTechnical}
        meta={metaEditor}
        missing={missing}
        onDelete={actions.remove}
        onDownload={actions.download}
        onEdit={actions.edit}
        onOpenSource={openSource}
        onResync={actions.resync}
        onUse={actions.use}
        usable={usable}
        workflow={workflow}
      />

      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={(value) => {
          if (isDetailTab(value)) {
            setActiveTab(value);
          }
        }}
        value={activeTab}
      >
        <TabsList
          className="border-border-subtle h-auto w-full justify-start gap-1 rounded-none border-b px-4"
          variant="line"
        >
          {DETAIL_TABS.map((tab) => (
            <TabsTrigger
              className="detail-tab-trigger h-auto flex-none rounded-none px-3 py-2.5 text-xs font-medium"
              key={tab.key}
              value={tab.key}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* 「编辑对外参数 / 实际使用」共用**同一个常驻实例**：表单与运行态在
            两个视图间是同一份，放进 TabsContent 会随切换卸载重建、填一半的参数
            被重置。用受控 hidden 容器承载，切页签只改 `viewMode`。
            挂载时机由 `controller.canvasMounted` 给：首次访问这两个页签之前不渲染，
            否则会拉起整个画布引擎；访问过后保持挂载。 */}
        {canvasMounted && (
          <div
            className="min-h-0 flex-1 overflow-y-auto p-5"
            hidden={activeTab !== "canvas" && activeTab !== "use"}
          >
            <DetailBody
              activeMode={activeMode}
              isLoading={isLoading}
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
              onActiveModeChange={setActiveMode}
              onEdit={actions.edit}
              onPatchParamMap={(next) => metaEditor.patchParamMap(next)}
              onSeedModeChange={(ioKey, mode) => {
                void metaEditor.patchSeedMode(ioKey, mode);
              }}
              paramMap={paramMap}
              sourceData={sourceData}
              tab={activeTab === "use" ? "use" : "canvas"}
              usable={usable}
              workflow={workflow}
              workflowIO={workflowIO}
            />
          </div>
        )}

        {(["params", "source"] as const).map((tab) => (
          <TabsContent className="min-h-0 flex-1 overflow-y-auto p-5" key={tab} value={tab}>
            <DetailBody
              activeMode={activeMode}
              isLoading={isLoading}
              meta={{
                modes: metaEditor.modes,
                defaultMode: metaEditor.defaultMode,
                onModeChange: (code) => {
                  setActiveMode(code);
                  void metaEditor.patchModes(metaEditor.modes, code);
                },
              }}
              onActiveModeChange={setActiveMode}
              onEdit={actions.edit}
              onPatchParamMap={(next) => metaEditor.patchParamMap(next)}
              onSeedModeChange={(ioKey, mode) => {
                void metaEditor.patchSeedMode(ioKey, mode);
              }}
              paramMap={paramMap}
              sourceData={sourceData}
              tab={tab}
              usable={usable}
              workflow={workflow}
              workflowIO={workflowIO}
            />
          </TabsContent>
        ))}
      </Tabs>

      {sourceOpen && (
        <SourceModal
          data={sourceData}
          error={errorMessage}
          loading={isLoading}
          onClose={closeSource}
        />
      )}
    </div>
  );
}
