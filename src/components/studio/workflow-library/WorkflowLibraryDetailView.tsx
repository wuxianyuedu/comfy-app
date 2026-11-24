"use client";

// WorkflowLibraryDetail 的纯展示视图：只消费 controller，不发请求、不算业务
// 规则，交互一律通过 controller.actions 上抛。

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ErrorBoundary } from "~/components/ui/error-boundary";
import { useLazyChunkFallback } from "~/components/ui/use-lazy-chunk-fallback";

import { SourceModal } from "~/components/studio/SourceModal";
import { logSubviewOpen, markSubviewOpenStart } from "~/components/studio/subview-open-log";
import type { WorkflowLibraryDetailController } from "./hooks/use-workflow-library-detail";
import { useWorkflowUpdateFromJson } from "./hooks/use-workflow-update-from-json";
import { UpdateJsonModal } from "./UpdateJsonModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DEFAULT_DETAIL_TAB,
  DETAIL_LOADING_LABEL,
  DETAIL_TABS,
  visibleDetailTabs,
  type DetailTab,
} from "./workflow-library-detail-config";
import { useWorkflowEncapsulation } from "./hooks/use-workflow-encapsulation";
import { DetailBody, TabContentLoading } from "./sections/DetailBody";
import { DetailHeader } from "./sections/DetailHeader";
import { WorkflowNotesTab } from "./sections/WorkflowNotesTab";

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
  openedAtRef,
}: {
  controller: WorkflowLibraryDetailController;
  /** 详情打开耗时的记账口（父级在点击那一刻写入；可缺省，见 config 的类型注释）。 */
  openedAtRef?: React.RefObject<number | null>;
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
    canConvert,
    missing,
    isTechnical,
    busyDownload,
    busyResync,
    busyConvert,
    actions,
  } = controller;
  /* dev server 重建后懒分块可能已被换掉，这一块自己给出路（与画布预览同款）。 */
  const ioChunkFallback = useLazyChunkFallback("IO 预览");

  /* 在线工作流的「从 JSON 更新」（#4377）：弹窗开关 + 提交 / 断线报告。 */
  const updateJson = useWorkflowUpdateFromJson();
  const [updateJsonOpen, setUpdateJsonOpen] = useState(false);

  /* #4463：断线报告属于「那一次更新」，不属于工作流 —— 切换选中工作流时
   * 清掉上一条的报告，B 的弹窗不再一打开就显示 A 的断线清单。 */
  const workflowIdForReport = workflow?.id ?? null;
  const clearUpdateJsonReport = updateJson.clearReport;
  useEffect(() => {
    clearUpdateJsonReport();
  }, [workflowIdForReport, clearUpdateJsonReport]);

  /* 「参考图装载」页签按工作流启用（默认不显示）：契约口里配置了参考图槽位
   * （在「工坊封装」页签给这条工作流加参考图口）才显示。判据与页签内容
   * （ReferenceLoaderTab）同一份取数与纯函数，不写两份。 */
  const encapsulation = useWorkflowEncapsulation({
    mode: activeMode,
    io: workflowIO,
    paramMap,
  });
  const referenceTabVisible = visibleDetailTabs(encapsulation.status.entries).some(
    (tab) => tab.key === "reference",
  );
  const visibleTabs = visibleDetailTabs(encapsulation.status.entries);
  /* 激活页签落在被隐藏的页签上时（启用被撤销 / 换了一条未启用的工作流）
   * 回退默认页签，避免 Tabs 的 value 找不到对应触发器。 */
  useEffect(() => {
    if (activeTab === "reference" && !referenceTabVisible) {
      setActiveTab(DEFAULT_DETAIL_TAB);
    }
  }, [activeTab, referenceTabVisible, setActiveTab]);

  /* 子界面打开耗时（ISSUE #4580）：从列表点击（父级经 openedAtRef 记的时刻）
   * 到详情数据落定。就绪判据与布局的加载态同一把尺（isLoading = 当前 workflow
   * 的键还没到过数据）—— 换工作流先挂新行、查询在飞时不记，落定那一刻才记。
   * 同一次打开只记一条：消费后把 ref 清回 null（重渲染 / 后台刷新再触发也无害）。
   * 子页签打开耗时（ISSUE #4592）：详情数据落定的同一提交里，落定的首个子页签
   * （默认工坊封装）内容即已就绪 —— 把这一层也记出来，日志才对得上「时间花在
   * 哪个子页签」；与「子界面打开」同用点击那一步的时刻，两行并排读。 */
  useEffect(() => {
    if (workflow === null || isLoading || openedAtRef === undefined) {
      return;
    }
    const openedAt = openedAtRef.current;
    if (openedAt === null) {
      return;
    }
    openedAtRef.current = null;
    logSubviewOpen("子界面打开", "工作流详情", workflow.name, openedAt, {
      workflowId: workflow.id,
    });
    const tabLabel = DETAIL_TABS.find((tab) => tab.key === activeTab)?.label ?? activeTab;
    logSubviewOpen("子页签打开", "工作流详情", tabLabel, openedAt, {
      tab: activeTab,
      workflowId: workflow.id,
      workflowName: workflow.name,
    });
  }, [workflow, isLoading, openedAtRef, activeTab]);

  /* 页签切换耗时（ISSUE #4580）：点击那一刻记时刻（onValueChange），切换提交
   * 完成（本 effect，commit 之后）落日志。懒页签（IO 预览）后续的分块下载
   * 不计入这一段 —— 那部分由页签内的加载态呈现。 */
  const tabSwitchedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const switchedAt = tabSwitchedAtRef.current;
    if (switchedAt === null) {
      return;
    }
    tabSwitchedAtRef.current = null;
    const label = DETAIL_TABS.find((tab) => tab.key === activeTab)?.label ?? activeTab;
    logSubviewOpen("页签切换", "工作流详情", label, switchedAt, { tab: activeTab });
  }, [activeTab]);

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
        busyConvert={busyConvert}
        busyDownload={busyDownload}
        busyResync={busyResync}
        busyUpdateJson={updateJson.submitting}
        canConvert={canConvert}
        canResync={canResync}
        isTechnical={isTechnical}
        meta={metaEditor}
        missing={missing}
        onConvert={actions.convert}
        onDelete={actions.remove}
        onDownload={actions.download}
        onEdit={actions.edit}
        onOpenSource={openSource}
        onResync={actions.resync}
        onUpdateJson={() => {
          setUpdateJsonOpen(true);
        }}
        onUse={actions.use}
        showUpdateJson={workflow.source === "online"}
        usable={usable}
        workflow={workflow}
      />

      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={(value) => {
          if (isDetailTab(value)) {
            tabSwitchedAtRef.current = markSubviewOpenStart();
            setActiveTab(value);
          }
        }}
        value={activeTab}
      >
        <TabsList
          className="border-border-subtle h-auto w-full justify-start gap-1 rounded-none border-b px-4"
          variant="line"
        >
          {visibleTabs.map((tab) => (
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
          {/* 详情查询未排空时给局部加载态（ISSUE #4592）：不按空 IO 渲染，也
              不留空白 —— 与 DetailBody 的 isLoading 同一款口径、同一句文案。 */}
          {isLoading ? (
            <TabContentLoading label={DETAIL_LOADING_LABEL} />
          ) : (
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

        {/* 说明页签（#4963）：note 正文 + 翻译成中文。轻面板，不拉画布引擎、
            不解析 rawJson —— note 已随 detailFull 富化到 controller.notes。 */}
        <TabsContent className="min-h-0 flex-1 overflow-y-auto p-5" value="notes">
          {isLoading ? (
            <TabContentLoading label={DETAIL_LOADING_LABEL} />
          ) : (
            <WorkflowNotesTab notes={controller.notes} />
          )}
        </TabsContent>

        {(["params", "reference", "source"] as const)
          .filter((tab) => tab !== "reference" || referenceTabVisible)
          .map((tab) => (
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

      {/* 在线工作流「从 JSON 更新」（#4377）：提交后断线报告就地展示（全部保持
       *  时自动关闭）。按 workflow.id 重建（#4463）：输入草稿 / 行内错误随工作流
       *  切换强制重置，不靠组件状态自己「记得」上一次。 */}
      <UpdateJsonModal
        key={workflow.id}
        onClose={() => {
          setUpdateJsonOpen(false);
        }}
        onSubmit={(raw) => {
          void updateJson.submit(workflow.id, raw).then((report) => {
            if (
              report !== null &&
              report.broken.length === 0 &&
              report.droppedIOKeys.length === 0
            ) {
              setUpdateJsonOpen(false);
            }
          });
        }}
        open={updateJsonOpen}
        report={updateJson.report}
        submitting={updateJson.submitting}
        workflowName={workflow.name}
      />
    </div>
  );
}
