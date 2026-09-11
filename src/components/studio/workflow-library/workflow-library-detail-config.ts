// WorkflowLibraryDetail 的纯配置与派生规则。
// 纯类型 + 纯函数（无 React、无副作用）：hook 据此算派生数据，视图只负责渲染。

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { WorkflowRow } from "./workflow-library-config";

/** 详情面板的三个页签 —— 数组顺序即渲染顺序。 */
export const DETAIL_TABS = [
  { key: "canvas", label: "画布节点" },
  { key: "params", label: "参数配置" },
  { key: "source", label: "源文件" },
] as const;

export type DetailTab = (typeof DETAIL_TABS)[number]["key"];

export interface WorkflowLibraryDetailProps {
  workflow: WorkflowRow | null;
  /** 用户级全局模型标签库（用于类型/模型编辑器）。 */
  allModelTags?: { id: string; name: string; count: number }[];
  /** 持久化类型（modes + defaultMode）。 */
  onPatchModes?: (id: string, modes: string[], defaultMode: string) => Promise<void>;
  /** 持久化模型标签绑定。 */
  onPatchModelTags?: (id: string, names: string[]) => Promise<void>;
  /** 整体落库 workflowIO（预览面板的 seed「控件后行为」等参数级配置）。 */
  onPatchWorkflowIO?: (id: string, workflowIO: Record<string, unknown>) => Promise<void>;
  onUse: (id: string, meta?: { name: string; taskType: string }) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onResync: (id: string, name: string) => void;
  /** 正在打包下载 / 正在重新同步的 workflow id（由父级持有）。 */
  bundleBusy: string | null;
  resyncBusy: string | null;
}

/** 详情接口里本面板用到的模板片段 —— 显式收窄，便于单测与复用。 */
export interface DetailTemplate {
  rawJson?: unknown;
  graph?: unknown;
  workflowIO?: unknown;
}

/** workflowIO 在旧数据里可能存成数组或非对象，这里收紧成 Map 或 null。 */
export function normalizeWorkflowIO(raw: unknown): WorkflowIOMap | null {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  return raw as WorkflowIOMap;
}

/** 「源文件」优先展示磁盘上的原始导入 JSON（用户当初导入的那个文件），纯 API
 *  导入拿不到原始文件时才回退到可执行图，并置 `isApiFallback` 让弹层如实标注。 */
export function buildSourceData(
  workflow: WorkflowRow,
  template: DetailTemplate | null | undefined
): SourceModalData | null {
  if (!template) return null;
  return {
    name: workflow.name,
    source: template.rawJson ?? template.graph ?? null,
    isApiFallback: template.rawJson == null,
  };
}

/** 详情请求是否对**当前渲染的**工作流就绪。
 *
 *  换工作流时 `useQuery({id})` 的 data 会短暂悬空（新 key 首次拉取），但
 *  `workflow` 行数据是同步就位的 —— 此时若把「选中行有值 + 查询在飞」当成
 *  加载态，右侧会先闪一屏「加载详情中…」再被真实内容顶掉，连带整页布局
 *  跳一下。判据因此收紧为「当前 workflow 的键还没到过数据」，而不是
 *  `isLoading`（它在换 key 与后台 refetch 时为真，二者都不该出现占位）。
 *
 *  未选中工作流时不算加载（空态由视图渲染）。 */
export function isDetailLoadingFor(
  workflowId: string | null,
  settledId: string | null,
): boolean {
  if (!workflowId) return false;
  return settledId !== workflowId;
}
