"use client";

// WorkflowLibraryDetail 的纯展示视图：只消费 controller，不发请求、不算业务
// 规则，交互一律通过 controller.actions 上抛。

import React from "react";
import { ExternalLink } from "lucide-react";
import { ErrorBoundary } from "~/components/ui/error-boundary";
import { useLazyChunkFallback } from "~/components/ui/use-lazy-chunk-fallback";

import { SourceModal } from "~/components/studio/SourceModal";
import type { WorkflowLibraryDetailController } from "./hooks/use-workflow-library-detail";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { DETAIL_TABS, type DetailTab } from "./workflow-library-detail-config";
import { DetailBody, TabContentLoading } from "./sections/DetailBody";
import { DetailHeader } from "./sections/DetailHeader";

/** Tabs 的值来自 `DETAIL_TABS` 的 key；集合外的值忽略。 */
function isDetailTab(value: unknown): value is DetailTab {
  return typeof value === "string" && DETAIL_TABS.some((tab) => tab.key === value);
}

/* IO 预览页签懒加载：它下面挂着 DynamicWorkflowForm 的编辑态，后者经 barrel
 * 拖出 @xyflow/react（见 check-barrel-heavy-deps 的静态可达图）。静态 import 会
 * 让打开工作流库就把画布引擎拉进 workspace 入口的静态图（规范 §12.19 / 02 §2.9），
 * 改成 dynamic 分块：只在切到 IO 预览页签时下载。 */
const LazyWorkflowLibraryIoPanel = React.lazy(() =>
  import("./sections/WorkflowLibraryIoPanel").then((m) => ({
    default: m.WorkflowLibraryIoPanel,
  })),
);

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
    storedIO,
    workflowModes,
    paramMap,
    sourceData,
    patchWorkflowIO,
    usable,
    canResync,
    missing,
    isTechnical,
    busyDownload,
    busyResync,
    actions,
  } = controller;
  /* dev server 重建后懒分块可能已被换掉，这一块自己给出路（与画布预览同款）。 */
  const ioChunkFallback = useLazyChunkFallback("IO 预览");

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

        {/* IO 预览页签：独立面板（不拉画布引擎）。改动即时经
             controller.patchWorkflowIO 落库，显示源是富化后的 workflowIO，
            落库底稿是模板原始 DB 列。 */}
        <TabsContent className="min-h-0 flex-1 overflow-y-auto p-5" value="io">
          {/* 详情查询未排空时不渲染：否则会先按空 IO 闪一屏「还没有暴露任何
              IO」再被真实数据顶掉（与 DetailBody 的 isLoading 同款口径）。 */}
          {!isLoading && (
            <ErrorBoundary fallback={ioChunkFallback}>
              {/* 懒分块的加载态收在本页签内容区（局部 Suspense）：没有这层
                  边界，suspend 会冒到路由级 fallback 换来整屏加载（ISSUE #3800）。 */}
              <React.Suspense fallback={<TabContentLoading label="加载 IO 预览…" />}>
                <LazyWorkflowLibraryIoPanel
                  activeMode={activeMode}
                  /* 与编辑器 IO 面板同一口径的模式数据：真实 modes（不做
                   * `[taskType]` 兜底）＋就地管理模式（落库走 patchModes）。 */
                  defaultMode={metaEditor.defaultMode}
                  /* 换工作流时重建草稿：详情面板是共用实例，不按 id 卸载，
                   * 不重建会把上一条工作流的乐观编辑带到这一条。 */
                  key={workflow.id}
                  modes={workflowModes}
                  onActiveModeChange={setActiveMode}
                  onModesChange={(modes, defaultMode) => {
                    void metaEditor.patchModes(modes, defaultMode);
                  }}
                  onPatchWorkflowIO={patchWorkflowIO}
                  storedIO={storedIO}
                  workflowIO={workflowIO}
                />
              </React.Suspense>
            </ErrorBoundary>
          )}
        </TabsContent>

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
