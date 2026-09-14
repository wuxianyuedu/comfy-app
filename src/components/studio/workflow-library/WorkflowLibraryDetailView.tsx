"use client";

// WorkflowLibraryDetail 的纯展示视图：只消费 controller，不发请求、不算业务
// 规则，交互一律通过 controller.actions 上抛。

import { ExternalLink } from "lucide-react";

import { SourceModal } from "~/components/studio/SourceModal";
import type { WorkflowLibraryDetailController } from "./hooks/use-workflow-library-detail";
import { DETAIL_TABS } from "./workflow-library-detail-config";
import { TabButton } from "./sections/DetailControls";
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
      <div className="flex h-full flex-col items-center justify-center text-ink-fainter">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-subtle">
          <ExternalLink className="h-7 w-7 opacity-40" />
        </div>
        <p className="text-sm">在左侧选择一个工作流查看详情</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel-deep">
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

      <div className="flex border-b border-border-subtle px-5">
        {DETAIL_TABS.map((tab) => (
          <TabButton
            key={tab.key}
            active={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </TabButton>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <DetailBody
          workflow={workflow}
          activeTab={activeTab}
          isLoading={isLoading}
          workflowIO={workflowIO}
          paramMap={paramMap}
          sourceData={sourceData}
          usable={usable}
          onEdit={actions.edit}
          meta={{
            modes: metaEditor.modes,
            defaultMode: metaEditor.defaultMode,
            onModeChange: (code) => {
              void metaEditor.patchModes(metaEditor.modes, code);
            },
          }}
          onSeedModeChange={(ioKey, mode) => {
            void metaEditor.patchSeedMode(ioKey, mode);
          }}
          onPatchParamMap={(next) => metaEditor.patchParamMap(next)}
        />
      </div>

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
