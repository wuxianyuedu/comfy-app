// WorkflowLibraryDetail 的纯配置与派生规则。
// 纯类型 + 纯函数（无 React、无副作用）：hook 据此算派生数据，视图只负责渲染。

import type { SourceModalData } from "~/components/studio/SourceModal";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import type { WorkflowRow } from "./workflow-library-config";

/** 详情面板的四个页签 —— 数组顺序即渲染顺序，**第一项也是默认页签**。
 *  「编辑对外参数 / 实际使用」原是「画布节点」内的子页签，拆成顶层页签少一层嵌套；
 *  两者共用同一个常驻实例（见 `WorkflowLibraryDetailView`），切页签只切视图模式，
 *  表单值与运行态不丢。默认页签取最轻的「工坊封装」：纯文字清单，不牵画布引擎与
 *  JSON 树渲染器；否则每打开一条工作流就把画布引擎拉起来。 */
/* SAFETY: 类型断言已复核 */
export const DETAIL_TABS = [
  { key: "params", label: "工坊封装" },
  { key: "canvas", label: "编辑对外参数" },
  { key: "use", label: "实际使用" },
  { key: "source", label: "源文件" },
] as const;

export type DetailTab = (typeof DETAIL_TABS)[number]["key"];

/** 打开一条工作流时的默认页签 —— 取表里的第一项（最轻的那个，见上）。 */
export const DEFAULT_DETAIL_TAB: DetailTab = DETAIL_TABS[0].key;

export type WorkflowLibraryDetailProps = {
  /** 用户级全局模型标签库（用于类型/模型编辑器）。 */
  allModelTags?: Array<{ count: number; id: string; name: string }>;
  /** 「这一条在下载 / 在同步吗」的判据（由父级的 `useItemAction` 给，
   *  规范 16 §16.2.4.40）—— 详情面板不再自己拿 id 去比。 */
  isBundleBusy: (id: string) => boolean;
  isResyncBusy: (id: string) => boolean;
  onDelete: (id: string, name: string) => void;
  onDownload: (id: string, name: string) => void;
  onEdit: (id: string) => void;
  /** 持久化模型标签绑定。 */
  onPatchModelTags?: (id: string, names: Array<string>) => Promise<void>;
  /** 持久化类型（modes + defaultMode）。 */
  onPatchModes?: (id: string, modes: Array<string>, defaultMode: string) => Promise<void>;
  /** 整体落库 paramMap（预览面板拖圆点改对外参数落点）。 */
  onPatchParamMap?: (id: string, paramMap: Record<string, unknown>) => Promise<void>;
  /** 整体落库 workflowIO（预览面板的 seed「控件后行为」等参数级配置）。 */
  onPatchWorkflowIO?: (id: string, workflowIO: Record<string, unknown>) => Promise<void>;
  onResync: (id: string, name: string) => void;
  onUse: (id: string, meta?: { name: string; taskType: string }) => void;
  workflow: WorkflowRow | null;
};

/** 详情接口里本面板用到的模板片段 —— 显式收窄，便于单测与复用。 */
export type DetailTemplate = {
  /** 工作流模板的 paramMap 列（含 `source.mode:<模式>` 的对外参数落点覆盖）。
   *  仅在类型层描述线上返回的 Json 列；库画布据此标出对外参数与落点归属。 */
  paramMap?: unknown;
  rawJson?: unknown;
  workflowIO?: unknown;
};

/** workflowIO 在旧数据里可能存成数组或非对象，这里收紧成 Map 或 null。 */
export function normalizeWorkflowIO(raw: unknown): WorkflowIOMap | null {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    return null;
  }
  /* SAFETY: 类型断言已复核 */
  return raw as WorkflowIOMap;
}

/** 「源文件」展示磁盘上的原始导入 JSON（用户当初导入的那个文件）：库里的
 *  `rawJson` 列就是它，带节点坐标与控件值，未做任何转换。 */
export function buildSourceData(
  workflow: WorkflowRow,
  template: DetailTemplate | null | undefined,
): SourceModalData | null {
  if (!template) {
    return null;
  }
  return {
    name: workflow.name,
    source: template.rawJson ?? null,
  };
}

/** 详情请求是否对**当前渲染的**工作流就绪。
 *  换工作流时 `useQuery({id})` 的 data 会短暂悬空，但 `workflow` 行数据同步就位；
 *  若把「选中行有值 + 查询在飞」当加载态，右侧会先闪一屏「加载详情中…」再被顶掉，
 *  整页布局跳一下。判据收紧为「当前 workflow 的键还没到过数据」，而不是
 *  `isLoading`（换 key 与后台 refetch 都为真）。未选中工作流时不算加载。 */
export function isDetailLoadingFor(workflowId: string | null, settledId: string | null): boolean {
  if (!workflowId) {
    return false;
  }
  return settledId !== workflowId;
}
