"use client";

/**
 * WorkflowLibrary 的业务逻辑层（规范 17 §17.2 第②层）。
 *
 * 承载：列表/标签查询与同步、三级筛选 + 搜索的选择状态、删除/下载/同步/载入
 * 四个动作的编排（复用 `useWorkflowActions`）、导入面板状态（复用
 * `useWorkflowImport`）、画布编辑器与模型管理弹层的开关。
 *
 * 视图（`WorkflowLibrary.tsx`）只消费这里返回的 controller：不碰 tRPC、
 * 不算筛选规则、不持有任何业务状态。对外 props（`onUse`）保持不变。
 *
 * 错误通道按 §17.5.4 拆两条：动作错误（`actionError`，只有用户重试才清）
 * 与加载错误（`loadError`，重新拉取成功即消失）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorMessage } from "~/lib/error-message";
import { api } from "~/trpc/react";

import { useToast } from "../../ToastProvider";
import {
  countBySource,
  countByType,
  filterPending,
  filterWorkflows,
  type PendingRow,
  type SourceFilter,
  type TypeFilter,
  type WorkflowRow,
} from "../workflow-library-config";
import { useWorkflowActions } from "./use-workflow-actions";
import { useWorkflowImport } from "./use-workflow-import";

/** 目录配置改动后，已挂载的列表要重新拉取（事件由 CustomNodesSettings 抛出）。 */
const PATHS_CHANGED_EVENT = "comfyapp:local-workflows-path-changed";

export interface WorkflowLibraryController {
  /** 过滤后的已载入工作流。 */
  workflows: WorkflowRow[];
  /** 过滤后的本地待载入项。 */
  pendingRows: PendingRow[];
  sourceCounts: ReturnType<typeof countBySource>;
  typeCounts: ReturnType<typeof countByType>;
  /** 模型标签（用于模型筛选页签）。 */
  modelTags: { id: string; name: string; count: number }[];
  /* 筛选 / 搜索状态 */
  search: string;
  setSearch: (value: string) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (value: SourceFilter) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (value: TypeFilter) => void;
  modelFilter: string;
  setModelFilter: (value: string) => void;
  /* 选择 */
  selectedId: string | null;
  selectedRow: WorkflowRow | null;
  setSelectedId: (id: string | null) => void;
  /* 弹层开关 */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  showModelManager: boolean;
  setShowModelManager: (value: boolean) => void;
  showImport: boolean;
  toggleImport: () => void;
  closeImport: () => void;
  importState: ReturnType<typeof useWorkflowImport>;
  /* 删除确认 */
  pendingDelete: { id: string; name: string } | null;
  deleting: boolean;
  cancelDelete: () => void;
  confirmDelete: (id: string) => Promise<void>;
  /* 忙碌标志 */
  bundleBusy: string | null;
  resyncBusy: string | null;
  /** 单个待载入项的「载入中」标志 —— 列表按 id 查表。 */
  pendingLoading: Record<string, boolean>;
  /* 错误：动作失败（不会自动消失） */
  actionError: string | null;
  /* 错误：列表拉取失败（重新拉取成功即消失） */
  loadError: string | null;
  /* 动作 */
  load: () => void;
  refresh: () => void;
  /** 模型标签变更后重新拉取（标签管理弹层关闭时由视图调用）。 */
  loadModelTags: () => void;
  handleUse: (id: string, meta?: { name: string; taskType: string }) => void;
  /** 持久化工作流类型（modes + defaultMode，defaultMode 回写 taskType）。 */
  patchModes: (id: string, modes: string[], defaultMode: string) => Promise<void>;
  /** 持久化模型标签绑定。 */
  patchModelTags: (id: string, names: string[]) => Promise<void>;
  /** 整体落库 workflowIO（详情预览的 seed「控件后行为」等参数级配置）。 */
  patchWorkflowIO: (id: string, workflowIO: Record<string, unknown>) => Promise<void>;
  handleDeleteClick: (id: string, name: string) => void;
  handleDownload: (id: string, name: string) => Promise<void>;
  handleResync: (id: string, name: string) => Promise<void>;
  handleLoadPending: (pending: PendingRow) => Promise<void>;
  handleEdit: (id: string) => void;
  /** 关闭画布编辑器：清 editingId 并失效该工作流的详情缓存（ISSUE #288）。 */
  handleEditorClose: () => void;
}

/** 列表数据与全部交互状态 —— 见文件头注释的分层说明。 */
export function useWorkflowLibrary(
  onUse?: (id: string, meta?: { name: string; taskType: string }) => void,
): WorkflowLibraryController {
  const toast = useToast();
  const utils = api.useUtils();

  const listQ = api.workflow.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const tagsQ = api.workflowModel.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const createMut = api.workflow.create.useMutation();
  const updateMut = api.workflow.update.useMutation();
  const deleteMut = api.workflow.delete.useMutation();
  const resyncMut = api.workflow.resync.useMutation();

  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [localPending, setLocalPending] = useState<PendingRow[]>([]);
  const [search, setSearch] = useState("");

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");

  const [showModelManager, setShowModelManager] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* §17.5.4：动作错误与加载错误分两条通道，否则后台刷新会把失败提示吞掉。
   *  `loadError` 直接由查询自身持有的 error 派生 —— react-query 重新拉取成功
   *  就会把它清掉，不需要我们自己记状态（自己记反而会和真实查询态漂移）。 */
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    /* refetch 在 tRPC 抛错时可能 reject、也可能 resolve 一个带 error 的结果
     * （取决于 throwOnError 配置），故这里只负责打日志 + 兜底触发一次重试，
     * 错误展示一律读 `listQ.error`。 */
    void listQ.refetch().catch((error: unknown) => {
      console.warn(
        "[WorkflowLibrary] 工作流列表拉取失败:",
        errorMessage(error, "未知错误"),
      );
    });
  }, [listQ]);

  const loadModelTags = useCallback(() => {
    tagsQ.refetch().catch(() => undefined);
  }, [tagsQ]);

  useEffect(() => {
    load();
    loadModelTags();
  }, [load, loadModelTags]);

  /** react-query 的数据要落进本地 state（列表是乐观更新 + 服务端回填混合）。
   *  用快照比对避免同一份数据反复 setState。 */
  const lastSyncedRef = useRef<string>("");
  useEffect(() => {
    if (!listQ.data) return;
    const snapshot = JSON.stringify({
      wf: listQ.data.workflows ?? [],
      pend: listQ.data.localPending ?? [],
    });
    if (snapshot === lastSyncedRef.current) return;
    lastSyncedRef.current = snapshot;
    setWorkflows((listQ.data.workflows ?? []) as unknown as WorkflowRow[]);
    setLocalPending(listQ.data.localPending ?? []);
    for (const workflow of listQ.data.workflows ?? []) {
      if (workflow.diskRenamed && workflow.diskRenamedTo) {
        toast.success("已自动重新链接", workflow.diskRenamedTo);
      }
    }
  }, [listQ.data, toast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = () => load();
    window.addEventListener(PATHS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(PATHS_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  const modelTags = useMemo(
    () =>
      (tagsQ.data?.tags ?? []) as { id: string; name: string; count: number }[],
    [tagsQ.data],
  );

  const filteredWorkflows = useMemo(
    () =>
      filterWorkflows(workflows, {
        source: sourceFilter,
        type: typeFilter,
        model: modelFilter,
        search,
      }),
    [workflows, search, sourceFilter, typeFilter, modelFilter],
  );

  const pendingRows = useMemo(
    () => filterPending(localPending, { source: sourceFilter, search }),
    [localPending, sourceFilter, search],
  );

  const sourceCounts = useMemo(
    () => countBySource(workflows, localPending),
    [workflows, localPending],
  );

  const typeCounts = useMemo(
    () => countByType(workflows, localPending),
    [workflows, localPending],
  );

  const selectedRow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) ?? null,
    [workflows, selectedId],
  );

  const [deleting, setDeleting] = useState(false);
  const [bundleBusy, setBundleBusy] = useState<string | null>(null);
  const [resyncBusy, setResyncBusy] = useState<string | null>(null);
  /* 只写不读：载入中的标志目前只由 `useWorkflowActions` 的 finally 清理，
   * 视图尚未渲染它（保持本次「只搬不改」）。保留是为了不丢掉这条状态通道。 */
  const [pendingLoading, setPendingLoading] = useState<Record<string, boolean>>(
    {},
  );

  const actions = useWorkflowActions({
    setDeleting,
    setPendingDelete,
    setActionError,
    setBundleBusy,
    setResyncBusy,
    setPendingLoading,
    setWorkflows,
    load,
    updateMut,
    deleteMut,
    resyncMut,
    createMut,
    utils,
  });

  const importState = useWorkflowImport({ createMut, load });

  /** 重试：由发起动作的一方清 actionError（§17.5.4）。 */
  const refresh = useCallback(() => {
    setActionError(null);
    load();
  }, [load]);

  const toggleImport = useCallback(
    () => importState.setShowImport((value) => !value),
    [importState],
  );
  const closeImport = useCallback(
    () => importState.setShowImport(false),
    [importState],
  );
  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const handleUse = useCallback(
    (id: string, meta?: { name: string; taskType: string }) => {
      onUse?.(id, meta);
    },
    [onUse],
  );

  const handleDeleteClick = useCallback((id: string, name: string) => {
    setPendingDelete({ id, name });
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const handleEdit = useCallback((id: string) => setEditingId(id), []);

  /* 关闭编辑器时失效该工作流的详情缓存。IO 编辑里改了默认值 / 覆盖层后，
   * 库详情（画布预览 + 参数配置）必须重拉富化 IO 才能看到新默认值；
   * react-query 的 staleTime 会让已挂载的库详情继续吃旧数据，回到库界面
   * 就表现为「默认值没更新」（ISSUE #288）。两种写入路径都覆盖：
   * 点「保存」落库的 workflowIO，以及排序等静默写。 */
  const handleEditorClose = useCallback(() => {
    const id = editingId;
    setEditingId(null);
    if (!id) return;
    void utils.workflow.detail.invalidate({ id });
    void utils.workflow.detailFull.invalidate({ id });
  }, [editingId, utils]);

  return {
    workflows: filteredWorkflows,
    pendingRows,
    sourceCounts,
    typeCounts,
    modelTags,
    search,
    setSearch,
    sourceFilter,
    setSourceFilter,
    typeFilter,
    setTypeFilter,
    modelFilter,
    setModelFilter,
    selectedId,
    selectedRow,
    setSelectedId,
    editingId,
    setEditingId,
    showModelManager,
    setShowModelManager,
    showImport: importState.showImport,
    toggleImport,
    closeImport,
    importState,
    pendingDelete,
    deleting,
    cancelDelete,
    confirmDelete: actions.handleDelete,
    bundleBusy,
    resyncBusy,
    pendingLoading,
    actionError,
    loadError: listQ.error
      ? `工作流列表加载失败：${errorMessage(listQ.error, "未知错误")}`
      : tagsQ.error
        ? `模型标签库加载失败：${errorMessage(tagsQ.error, "未知错误")}`
        : null,
    load,
    refresh,
    loadModelTags,
    handleUse,
    handleDeleteClick,
    handleDownload: actions.downloadJson,
    handleResync: actions.resyncWorkflow,
    handleLoadPending: actions.handleLoadPending,
    handleEdit,
    handleEditorClose,
    patchModes: actions.patchModes,
    patchModelTags: actions.patchModelTags,
    patchWorkflowIO: actions.patchWorkflowIO,
  };
}
