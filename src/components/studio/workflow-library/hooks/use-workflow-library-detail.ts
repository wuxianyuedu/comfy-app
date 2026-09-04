"use client";

// WorkflowLibraryDetail 的全部业务逻辑：详情拉取、格式 / 同步标志派生、页签
// 与源文件弹层开关。视图只消费这里返回的 controller，不持有任何业务规则。

import { useCallback, useMemo, useState } from "react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { api } from "~/trpc/react";
import {
  buildSourceData,
  normalizeWorkflowIO,
  type DetailTab,
  type WorkflowLibraryDetailProps,
} from "../workflow-library-detail-config";
import {
  deriveFormatFlags,
  deriveSyncFlags,
  isTechnicalName,
  type WorkflowRow,
} from "../workflow-library-config";

export interface WorkflowLibraryDetailActions {
  use: () => void;
  edit: () => void;
  remove: () => void;
  download: () => void;
  resync: () => void;
}

export interface WorkflowLibraryDetailController {
  /** null = 左侧未选中工作流，视图据此渲染空态。 */
  workflow: WorkflowRow | null;
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  sourceOpen: boolean;
  openSource: () => void;
  closeSource: () => void;
  isLoading: boolean;
  errorMessage: string | undefined;
  workflowIO: WorkflowIOMap | null;
  sourceData: SourceModalData | null;
  /** 有可执行图 —— 决定主 CTA 是否可点。 */
  usable: boolean;
  canResync: boolean;
  missing: boolean;
  /** 名字是 ComfyUI 默认技术名（纯小写 + 下划线），改用等宽字体更易读。 */
  isTechnical: boolean;
  busyDownload: boolean;
  busyResync: boolean;
  actions: WorkflowLibraryDetailActions;
}

export function useWorkflowLibraryDetail(
  props: WorkflowLibraryDetailProps
): WorkflowLibraryDetailController {
  const {
    workflow,
    bundleBusy,
    resyncBusy,
    onUse,
    onEdit,
    onDelete,
    onDownload,
    onResync,
  } = props;

  const [sourceOpen, setSourceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("canvas");

  const openSource = useCallback(() => setSourceOpen(true), []);
  const closeSource = useCallback(() => setSourceOpen(false), []);

  /* 未选中工作流时不发请求（enabled:false）。hooks 顺序必须稳定，因此这里不
   * 做 early return —— 空态交给视图渲染。 */
  const detailQuery = api.workflow.detail.useQuery(
    { id: workflow?.id ?? "" },
    { enabled: !!workflow }
  );

  const template = detailQuery.data?.template;

  const workflowIO = useMemo(() => normalizeWorkflowIO(template?.workflowIO), [template]);

  const sourceData = useMemo(
    () => (workflow ? buildSourceData(workflow, template) : null),
    [workflow, template]
  );

  const formatFlags = useMemo(
    () =>
      workflow
        ? deriveFormatFlags(workflow)
        : { hasApi: false, hasRaw: false, apiOrigin: null, usable: false },
    [workflow]
  );

  const syncFlags = useMemo(
    () =>
      workflow
        ? deriveSyncFlags(workflow)
        : { dirty: false, missing: false, canResync: false },
    [workflow]
  );

  const actions = useMemo<WorkflowLibraryDetailActions>(
    () => ({
      use: () => {
        if (!workflow) return;
        onUse(workflow.id, { name: workflow.name, taskType: workflow.taskType });
      },
      edit: () => {
        if (workflow) onEdit(workflow.id);
      },
      remove: () => {
        if (workflow) onDelete(workflow.id, workflow.name);
      },
      download: () => {
        if (workflow) onDownload(workflow.id, workflow.name);
      },
      resync: () => {
        if (workflow) onResync(workflow.id, workflow.name);
      },
    }),
    [workflow, onUse, onEdit, onDelete, onDownload, onResync]
  );

  return {
    workflow,
    activeTab,
    setActiveTab,
    sourceOpen,
    openSource,
    closeSource,
    isLoading: detailQuery.isLoading,
    errorMessage: detailQuery.error?.message,
    workflowIO,
    sourceData,
    usable: formatFlags.usable,
    canResync: syncFlags.canResync,
    missing: syncFlags.missing,
    isTechnical: !!workflow && isTechnicalName(workflow.name),
    busyDownload: !!workflow && bundleBusy === workflow.id,
    busyResync: !!workflow && resyncBusy === workflow.id,
    actions,
  };
}
