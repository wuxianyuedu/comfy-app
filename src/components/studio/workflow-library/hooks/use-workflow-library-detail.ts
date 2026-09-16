"use client";

// WorkflowLibraryDetail 的全部业务逻辑：详情拉取、格式 / 同步标志派生、页签
// 与源文件弹层开关。视图只消费这里返回的 controller，不持有任何业务规则。

import { useCallback, useMemo, useState } from "react";

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { api } from "~/trpc/react";
import {
  buildSourceData,
  isDetailLoadingFor,
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

/** 类型 / 模型编辑器的派生数据与动作（规范 17 §17.2 第②层）。 */
export interface MetaEditorController {
  /** 当前生效的 mode 集合（缺省回退 [taskType]，兼容旧行）。 */
  modes: string[];
  defaultMode: string;
  /** 已绑定的模型标签名。 */
  modelTags: string[];
  /** 全部可选模型标签。 */
  allModelTags: { id: string; name: string; count: number }[];
  busy: boolean;
  patchModes: (modes: string[], defaultMode: string) => Promise<void>;
  patchModelTags: (names: string[]) => Promise<void>;
  /** 持久化某个 IO 参数的 seed「控件后行为」（fixed/increment/decrement/random）。
   *  写进 workflowIO 条目并整体落库，预览面板与画布运行时共用。 */
  patchSeedMode: (ioKey: string, mode: string) => Promise<void>;
  /** 持久化对外参数落点（预览面板拖圆点改落点 / 断开 / 恢复默认）。
   *  整列写回 `paramMap.source.mode:<模式>`，与编辑器画布同一份形状。 */
  patchParamMap: (next: Record<string, unknown>) => Promise<void>;
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
  /** 模板 paramMap（`source.mode:<模式>` 的对外参数落点），画布节点页签据此
   *  标出每个对外参数与它落到的那一行。 */
  paramMap: Record<string, unknown>;
  sourceData: SourceModalData | null;
  /** 有可执行图 —— 决定主 CTA 是否可点。 */
  usable: boolean;
  canResync: boolean;
  missing: boolean;
  /** 名字是 ComfyUI 默认技术名（纯小写 + 下划线），改用等宽字体更易读。 */
  isTechnical: boolean;
  busyDownload: boolean;
  busyResync: boolean;
  /** 类型 / 模型编辑器（缺省空实现，调用方可安全忽略）。 */
  metaEditor: MetaEditorController;
  actions: WorkflowLibraryDetailActions;
}

export function useWorkflowLibraryDetail(
  props: WorkflowLibraryDetailProps,
): WorkflowLibraryDetailController {
  const {
    workflow,
    allModelTags = [],
    onPatchModes,
    onPatchModelTags,
    onPatchWorkflowIO,
    onPatchParamMap,
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
    { enabled: !!workflow },
  );

  const template = detailQuery.data?.template;

  /* 富化 IO：workflow.detail 直读 DB 列 —— 没有 COMBO 候选表，模式默认值
   * 也可能是旧候选表时代写入的脏值（如简写 "16:9"），照原样渲染，用户
   * 无论怎么选提交的都是服务器不认的值。detailFull 走服务端富化（候选
   * 表解析 + 存量清洗），这里取它的 workflowIO 覆盖原始列；rawJson /
   * graph 等仍用轻量 template，patchSeedMode 也继续以原始列为底稿。 */
  const enrichedQuery = api.workflow.detailFull.useQuery(
    { id: workflow?.id ?? "" },
    { enabled: !!workflow },
  );

  /* 就绪条件：当前选中工作流已排空过一次详情请求的数据（或错误）。
   *  `detailQuery.isLoading` 在「换工作流」和「后台 refetch」两种情况下都为
   *  真，但两者都不该让右侧闪一屏占位——前者问的是上一个 key，后者是后台刷新。
   *  判定搬进 config 里的纯函数，本文件只负责喂值。 */
  const detailSettledId = detailQuery.data
    ? (workflow?.id ?? null)
    : detailQuery.error
      ? (workflow?.id ?? null)
      : null;
  const enrichedSettled = !!enrichedQuery.data || !!enrichedQuery.error;
  /* detailFull 是与 detail 并行的第二个请求；两者都排空才把表单交给预览，
   * 否则表单会先按空 IO 渲染再重排一次（左下「首次打开布局切换」）。 */
  const isDetailLoading =
    isDetailLoadingFor(workflow?.id ?? null, detailSettledId) ||
    (!!workflow && !enrichedSettled);

  const workflowIO = useMemo(
    () =>
      normalizeWorkflowIO(enrichedQuery.data?.workflowIO) ??
      normalizeWorkflowIO(template?.workflowIO),
    [enrichedQuery.data, template],
  );

  const sourceData = useMemo(
    () => (workflow ? buildSourceData(workflow, template) : null),
    [workflow, template],
  );

  /* paramMap 只有「画布节点」页签的对外参数标注用得上：以轻量 template 为底
   * 稿（它直读 DB 列，没有富化改写），缺省空对象。 */
  const paramMap = useMemo<Record<string, unknown>>(() => {
    const raw = template?.paramMap;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }, [template]);

  const formatFlags = useMemo(
    () =>
      workflow
        ? deriveFormatFlags(workflow)
        : { hasApi: false, hasRaw: false, apiOrigin: null, usable: false },
    [workflow],
  );

  const syncFlags = useMemo(
    () =>
      workflow
        ? deriveSyncFlags(workflow)
        : { dirty: false, missing: false, canResync: false },
    [workflow],
  );

  const actions = useMemo<WorkflowLibraryDetailActions>(
    () => ({
      use: () => {
        if (!workflow) return;
        onUse(workflow.id, {
          name: workflow.name,
          taskType: workflow.taskType,
        });
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
    [workflow, onUse, onEdit, onDelete, onDownload, onResync],
  );

  const metaEditor = useMemo<MetaEditorController>(
    () => ({
      modes:
        workflow?.modes && workflow.modes.length > 0
          ? workflow.modes
          : workflow
            ? [workflow.taskType]
            : [],
      defaultMode: workflow?.defaultMode ?? workflow?.taskType ?? "",
      modelTags: workflow?.modelTags ?? [],
      allModelTags,
      busy:
        !!workflow &&
        (bundleBusy === workflow.id || resyncBusy === workflow.id),
      patchModes: async (modes, defaultMode) => {
        if (!workflow || !onPatchModes) return;
        await onPatchModes(workflow.id, modes, defaultMode);
      },
      patchModelTags: async (names) => {
        if (!workflow || !onPatchModelTags) return;
        await onPatchModelTags(workflow.id, names);
      },
      patchParamMap: async (next) => {
        if (!workflow || !onPatchParamMap) return;
        await onPatchParamMap(workflow.id, next);
      },
      patchSeedMode: async (ioKey, mode) => {
        if (!workflow || !onPatchWorkflowIO) return;
        /* 在模板原始 workflowIO 上只改目标条目的 seedMode，整体落库；
         * 其余字段原样透传，避免用富化视图覆盖原始数据。 */
        const raw = (template?.workflowIO ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const next: Record<string, unknown> = {
          ...raw,
          [ioKey]: { ...(raw[ioKey] ?? {}), seedMode: mode },
        };
        await onPatchWorkflowIO(workflow.id, next);
      },
    }),
    [
      workflow,
      allModelTags,
      bundleBusy,
      resyncBusy,
      onPatchModes,
      onPatchModelTags,
      onPatchWorkflowIO,
      onPatchParamMap,
      template,
    ],
  );

  return {
    workflow,
    metaEditor,
    activeTab,
    setActiveTab,
    sourceOpen,
    openSource,
    closeSource,
    isLoading: isDetailLoading,
    errorMessage: detailQuery.error?.message,
    workflowIO,
    paramMap,
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
